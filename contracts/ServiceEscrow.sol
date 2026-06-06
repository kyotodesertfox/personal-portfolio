// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

// ServiceEscrow - milestone payment escrow for independent IT/web services.
// Adapted from TokenEscrow (Homestead). Token minting removed - pure ETH flow.
// Justin (owner/initiator) creates escrows per milestone. Client (counterparty)
// funds with exact ETH. Both confirm delivery. ETH releases to Justin.
// Financing is supported naturally - open one escrow per milestone.

contract ServiceEscrow is UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable, ReentrancyGuardTransient {

    // =========================================================================
    // STORAGE - DO NOT REORDER OR DELETE EXISTING VARIABLES
    // Add new variables above __gap, reducing gap size accordingly.
    // =========================================================================

    address public feeRecipient;  // receives feeBps cut on release (can be owner's own wallet)
    uint256 public feeBps;        // platform fee in basis points (0 = no fee)

    uint256 public nextEscrowId;
    mapping(uint256 => Escrow) private _escrows;

    uint256[46] private __gap;

    // =========================================================================

    struct Escrow {
        address initiator;       // Justin's wallet - receives ETH on release
        address counterparty;    // client wallet - deposits ETH
        string  description;     // milestone label e.g. "Phase 1 - Design"
        uint256 ethRequired;     // ETH client must deposit to activate
        uint256 ethDeposited;    // actual ETH deposited
        bool initiatorConfirmed;
        bool counterpartyConfirmed;
        bool released;
        bool cancelled;
    }

    event EscrowCreated(uint256 indexed escrowId, address indexed initiator, address indexed counterparty, string description, uint256 ethRequired);
    event Funded(uint256 indexed escrowId, address indexed counterparty, uint256 amount);
    event Confirmed(uint256 indexed escrowId, address indexed confirmedBy);
    event Released(uint256 indexed escrowId, address indexed initiator, uint256 ethAmount, uint256 fee);
    event Cancelled(uint256 indexed escrowId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _feeRecipient,
        uint256 _feeBps
    ) initializer public {
        __Ownable_init(msg.sender);
        __Pausable_init();

        feeRecipient = _feeRecipient;
        feeBps       = _feeBps;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // =========================================================================
    // ESCROW LIFECYCLE
    // =========================================================================

    // Justin opens a milestone escrow for a client.
    // description should identify the milestone clearly for both parties.
    function create(
        address counterparty,
        string calldata description,
        uint256 ethRequired
    ) external onlyOwner nonReentrant whenNotPaused returns (uint256 escrowId) {
        require(counterparty != address(0), 'ServiceEscrow: ZERO_COUNTERPARTY');
        require(bytes(description).length > 0, 'ServiceEscrow: EMPTY_DESCRIPTION');
        require(ethRequired > 0,            'ServiceEscrow: ZERO_ETH');

        escrowId = nextEscrowId++;

        _escrows[escrowId].initiator    = msg.sender;
        _escrows[escrowId].counterparty = counterparty;
        _escrows[escrowId].description  = description;
        _escrows[escrowId].ethRequired  = ethRequired;

        emit EscrowCreated(escrowId, msg.sender, counterparty, description, ethRequired);
    }

    // Client deposits exact ETH to activate the escrow.
    function fund(uint256 escrowId) external payable nonReentrant whenNotPaused {
        Escrow storage e = _escrows[escrowId];
        require(e.initiator != address(0),    'ServiceEscrow: NOT_FOUND');
        require(msg.sender == e.counterparty, 'ServiceEscrow: NOT_COUNTERPARTY');
        require(e.ethDeposited == 0,          'ServiceEscrow: ALREADY_FUNDED');
        require(!e.cancelled,                 'ServiceEscrow: CANCELLED');
        require(msg.value == e.ethRequired,   'ServiceEscrow: WRONG_ETH_AMOUNT');

        e.ethDeposited = msg.value;

        emit Funded(escrowId, msg.sender, msg.value);
    }

    // Either party confirms delivery. Release fires automatically when both confirm.
    function confirm(uint256 escrowId) external nonReentrant whenNotPaused {
        Escrow storage e = _escrows[escrowId];
        require(e.initiator != address(0),                                  'ServiceEscrow: NOT_FOUND');
        require(e.ethDeposited > 0,                                         'ServiceEscrow: NOT_FUNDED');
        require(!e.released,                                                'ServiceEscrow: ALREADY_RELEASED');
        require(!e.cancelled,                                               'ServiceEscrow: CANCELLED');
        require(msg.sender == e.initiator || msg.sender == e.counterparty, 'ServiceEscrow: NOT_PARTY');

        if (msg.sender == e.initiator) {
            require(!e.initiatorConfirmed,    'ServiceEscrow: ALREADY_CONFIRMED');
            e.initiatorConfirmed = true;
        } else {
            require(!e.counterpartyConfirmed, 'ServiceEscrow: ALREADY_CONFIRMED');
            e.counterpartyConfirmed = true;
        }

        emit Confirmed(escrowId, msg.sender);

        if (e.initiatorConfirmed && e.counterpartyConfirmed) {
            _release(escrowId);
        }
    }

    // Fires on dual confirm. Optional fee to feeRecipient, remainder to Justin.
    function _release(uint256 escrowId) internal {
        Escrow storage e = _escrows[escrowId];
        e.released = true;

        uint256 fee        = feeBps > 0 ? (e.ethDeposited * feeBps) / 10000 : 0;
        uint256 initiatorEth = e.ethDeposited - fee;

        if (fee > 0 && feeRecipient != address(0)) {
            (bool feeOk,) = feeRecipient.call{value: fee}("");
            require(feeOk, 'ServiceEscrow: FEE_FAILED');
        } else {
            // If no feeRecipient is set, fold the fee back into initiator payment
            initiatorEth = e.ethDeposited;
        }

        (bool ethOk,) = e.initiator.call{value: initiatorEth}("");
        require(ethOk, 'ServiceEscrow: ETH_TRANSFER_FAILED');

        emit Released(escrowId, e.initiator, initiatorEth, fee);
    }

    // Cancel an escrow.
    // Before funded: Justin cancels unilaterally.
    // After funded: both parties must agree - ETH returned to client.
    function cancel(uint256 escrowId) external nonReentrant {
        Escrow storage e = _escrows[escrowId];
        require(e.initiator != address(0),                                  'ServiceEscrow: NOT_FOUND');
        require(!e.released,                                                'ServiceEscrow: ALREADY_RELEASED');
        require(!e.cancelled,                                               'ServiceEscrow: ALREADY_CANCELLED');
        require(msg.sender == e.initiator || msg.sender == e.counterparty, 'ServiceEscrow: NOT_PARTY');

        if (e.ethDeposited == 0) {
            require(msg.sender == e.initiator, 'ServiceEscrow: ONLY_INITIATOR');
            e.cancelled = true;
            emit Cancelled(escrowId);
            return;
        }

        // After funded: both must agree. Reuse confirm flags for cancel vote.
        if (msg.sender == e.initiator)    e.initiatorConfirmed    = true;
        if (msg.sender == e.counterparty) e.counterpartyConfirmed = true;

        if (e.initiatorConfirmed && e.counterpartyConfirmed) {
            e.cancelled = true;
            (bool ok,) = e.counterparty.call{value: e.ethDeposited}("");
            require(ok, 'ServiceEscrow: ETH_RETURN_FAILED');
            emit Cancelled(escrowId);
        }
    }

    // =========================================================================
    // READ
    // =========================================================================

    function getEscrow(uint256 escrowId) external view returns (
        address initiator,
        address counterparty,
        string memory description,
        uint256 ethRequired,
        uint256 ethDeposited,
        bool initiatorConfirmed,
        bool counterpartyConfirmed,
        bool released,
        bool cancelled
    ) {
        Escrow storage e = _escrows[escrowId];
        return (
            e.initiator,
            e.counterparty,
            e.description,
            e.ethRequired,
            e.ethDeposited,
            e.initiatorConfirmed,
            e.counterpartyConfirmed,
            e.released,
            e.cancelled
        );
    }

    // =========================================================================
    // ADMIN
    // =========================================================================

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        feeRecipient = _feeRecipient;
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, 'ServiceEscrow: FEE_TOO_HIGH'); // 10% max
        feeBps = _feeBps;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    receive() external payable {}
}
