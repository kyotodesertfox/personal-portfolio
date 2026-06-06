// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

// ClientLedger - milestone escrow + client profiles for IT/web services.
//
// Lifecycle:
//   Client submits inquiry (0.1 ETH deposit) -> owner accepts -> project opens
//   Owner and client propose/confirm line items (scope agreement, both sign)
//   Client deposits ETH to cover active items
//   Work done -> both sign off -> ETH releases per item
//   Referral credits reduce the effective amount a client owes on each item

interface IDebtToken {
    function mint(address to, uint256 tokenId, uint256 amount) external;
    function burn(address from, uint256 tokenId, uint256 amount) external;
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

contract ClientLedger is UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable {

    // =========================================================================
    // STORAGE - DO NOT REORDER OR DELETE EXISTING VARIABLES
    // =========================================================================

    address public debtToken;
    address public feeRecipient;
    uint256 public feeBps;
    uint256 public inquiryDeposit;

    uint256 public nextInquiryId;
    uint256 public nextProjectId;

    mapping(address  => ClientProfile)                       public  clientProfiles;
    mapping(uint256  => Inquiry)                             private _inquiries;
    mapping(uint256  => Project)                             private _projects;
    mapping(uint256  => mapping(uint256 => LineItem))        private _lineItems;

    bool    private _locked;
    mapping(uint256 => uint256) public inquiryScopeCount;
    mapping(uint256 => mapping(uint256 => bool)) public scopeItemCancelled;
    uint256[37] private __gap;

    modifier nonReentrant() {
        require(!_locked, 'ClientLedger: REENTRANT');
        _locked = true;
        _;
        _locked = false;
    }

    // =========================================================================

    struct ClientProfile {
        address referredBy;
        uint256 referralCredits; // wei-equivalent; reduces effective line item cost
        bool    registered;
    }

    struct Inquiry {
        address client;
        uint256 deposit;
        bool    accepted;
        bool    declined;
        bool    readyForReview;
        uint256 projectId;
    }

    struct Project {
        address client;
        string  description;
        uint256 inquiryId;
        uint256 deposited;   // total ETH in contract for this project
        uint256 allocated;   // locked to active line items
        uint256 released;    // paid out to owner
        bool    financed;    // true = DebtToken minted per item
        uint256 lineItemCount;
        bool    cancelled;
    }

    struct LineItem {
        string  description;
        uint256 ethAmount;        // original quoted amount
        uint256 effectiveAmount;  // after referral credits applied at confirm time
        bool    proposedByOwner;
        bool    active;           // both parties agreed on scope; funds allocated
        bool    ownerDone;
        bool    clientDone;
        bool    released;
        bool    removalProposed;
        address removalProposedBy;
        bool    removed;
    }

    // Events
    event ScopeItemRequested(uint256 indexed inquiryId, uint256 indexed itemId, string description, uint256 ethAmount);
    event ScopeItemCancelled(uint256 indexed inquiryId, uint256 indexed itemId);
    event InquiryReadyForReview(uint256 indexed inquiryId);
    event InquirySubmitted(uint256 indexed inquiryId, address indexed client, uint256 deposit);
    event InquiryAccepted(uint256 indexed inquiryId, uint256 indexed projectId);
    event InquiryDeclined(uint256 indexed inquiryId, address indexed client);
    event Deposited(uint256 indexed projectId, address indexed client, uint256 amount);
    event LineItemProposed(uint256 indexed projectId, uint256 indexed itemId, string description, uint256 ethAmount);
    event LineItemConfirmed(uint256 indexed projectId, uint256 indexed itemId, uint256 effectiveAmount);
    event WorkConfirmed(uint256 indexed projectId, uint256 indexed itemId, address confirmedBy);
    event LineItemReleased(uint256 indexed projectId, uint256 indexed itemId, uint256 ownerEth, uint256 fee);
    event RemovalProposed(uint256 indexed projectId, uint256 indexed itemId, address proposedBy);
    event LineItemRemoved(uint256 indexed projectId, uint256 indexed itemId);
    event CreditsAwarded(address indexed client, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address _debtToken,
        address _feeRecipient,
        uint256 _feeBps,
        uint256 _inquiryDeposit
    ) initializer public {
        __Ownable_init(msg.sender);
        __Pausable_init();

        debtToken      = _debtToken;
        feeRecipient   = _feeRecipient;
        feeBps         = _feeBps;
        inquiryDeposit = _inquiryDeposit;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // =========================================================================
    // CLIENT PROFILES
    // =========================================================================

    function registerClient(address client, address referredBy) external onlyOwner {
        require(!clientProfiles[client].registered, 'ClientLedger: ALREADY_REGISTERED');
        clientProfiles[client].registered = true;
        clientProfiles[client].referredBy = referredBy;
    }

    function awardCredits(address client, uint256 amount) external onlyOwner {
        require(clientProfiles[client].registered, 'ClientLedger: NOT_REGISTERED');
        clientProfiles[client].referralCredits += amount;
        emit CreditsAwarded(client, amount);
    }

    // =========================================================================
    // INQUIRY LIFECYCLE
    // =========================================================================

    // Client submits 0.1 ETH deposit to open an inquiry. Auto-registers wallet.
    // Mints DebtTokens equal to the deposit - tokenId is the inquiryId, used throughout the project lifecycle.
    function submitInquiry() external payable nonReentrant whenNotPaused {
        require(msg.value == inquiryDeposit, 'ClientLedger: WRONG_DEPOSIT');

        if (!clientProfiles[msg.sender].registered) {
            clientProfiles[msg.sender].registered = true;
        }

        uint256 inquiryId = nextInquiryId++;
        _inquiries[inquiryId] = Inquiry({
            client:          msg.sender,
            deposit:         msg.value,
            accepted:        false,
            declined:        false,
            readyForReview:  false,
            projectId:       0
        });

        if (debtToken != address(0)) {
            IDebtToken(debtToken).mint(msg.sender, inquiryId, 1);
        }

        emit InquirySubmitted(inquiryId, msg.sender, msg.value);
    }

    // Owner accepts inquiry - opens a project, inquiry deposit credited as first deposit.
    function acceptInquiry(
        uint256 inquiryId,
        string calldata description,
        bool financed
    ) external onlyOwner nonReentrant {
        Inquiry storage inq = _inquiries[inquiryId];
        require(inq.client != address(0),       'ClientLedger: NOT_FOUND');
        require(!inq.accepted && !inq.declined,  'ClientLedger: ALREADY_RESOLVED');

        uint256 projectId = nextProjectId++;
        inq.accepted  = true;
        inq.projectId = projectId;

        _projects[projectId] = Project({
            client:        inq.client,
            description:   description,
            inquiryId:     inquiryId,
            deposited:     inq.deposit,
            allocated:     0,
            released:      0,
            financed:      financed,
            lineItemCount: 0,
            cancelled:     false
        });

        emit InquiryAccepted(inquiryId, projectId);
    }

    // Client withdraws their own pending inquiry - deposit refunded, tokens burned.
    function withdrawInquiry(uint256 inquiryId) external nonReentrant {
        Inquiry storage inq = _inquiries[inquiryId];
        require(inq.client == msg.sender,        'ClientLedger: NOT_CLIENT');
        require(!inq.accepted && !inq.declined,  'ClientLedger: ALREADY_RESOLVED');

        inq.declined = true;

        if (debtToken != address(0)) {
            uint256 bal = IDebtToken(debtToken).balanceOf(inq.client, inquiryId);
            if (bal > 0) IDebtToken(debtToken).burn(inq.client, inquiryId, bal);
        }

        (bool ok,) = inq.client.call{value: inq.deposit}("");
        require(ok, 'ClientLedger: REFUND_FAILED');

        emit InquiryDeclined(inquiryId, inq.client);
    }

    // Owner declines inquiry - deposit refunded, tokens burned.
    function declineInquiry(uint256 inquiryId) external onlyOwner nonReentrant {
        Inquiry storage inq = _inquiries[inquiryId];
        require(inq.client != address(0),       'ClientLedger: NOT_FOUND');
        require(!inq.accepted && !inq.declined,  'ClientLedger: ALREADY_RESOLVED');

        inq.declined = true;

        if (debtToken != address(0)) {
            uint256 bal = IDebtToken(debtToken).balanceOf(inq.client, inquiryId);
            if (bal > 0) IDebtToken(debtToken).burn(inq.client, inquiryId, bal);
        }

        (bool ok,) = inq.client.call{value: inq.deposit}("");
        require(ok, 'ClientLedger: REFUND_FAILED');

        emit InquiryDeclined(inquiryId, inq.client);
    }

    // =========================================================================
    // PROJECT FUNDING
    // =========================================================================

    function deposit(uint256 projectId) external payable nonReentrant whenNotPaused {
        Project storage p = _projects[projectId];
        require(p.client != address(0),  'ClientLedger: NOT_FOUND');
        require(msg.sender == p.client,  'ClientLedger: NOT_CLIENT');
        require(!p.cancelled,            'ClientLedger: CANCELLED');
        require(msg.value > 0,           'ClientLedger: ZERO_AMOUNT');

        p.deposited += msg.value;

        emit Deposited(projectId, msg.sender, msg.value);
    }

    // =========================================================================
    // LINE ITEMS
    // =========================================================================

    // Client submits their desired scope items before the inquiry is accepted.
    function requestScopeItem(
        uint256 inquiryId,
        string calldata description,
        uint256 ethAmount
    ) external nonReentrant whenNotPaused {
        Inquiry storage inq = _inquiries[inquiryId];
        require(inq.client == msg.sender,        'ClientLedger: NOT_CLIENT');
        require(!inq.accepted && !inq.declined,  'ClientLedger: ALREADY_RESOLVED');
        require(ethAmount > 0,                   'ClientLedger: ZERO_AMOUNT');
        require(bytes(description).length > 0,   'ClientLedger: EMPTY_DESCRIPTION');

        uint256 itemId = inquiryScopeCount[inquiryId]++;
        emit ScopeItemRequested(inquiryId, itemId, description, ethAmount);
    }

    // Client cancels a previously requested scope item (pending inquiries only).
    function cancelScopeItem(uint256 inquiryId, uint256 itemId) external nonReentrant {
        Inquiry storage inq = _inquiries[inquiryId];
        require(inq.client == msg.sender,        'ClientLedger: NOT_CLIENT');
        require(!inq.accepted && !inq.declined,  'ClientLedger: ALREADY_RESOLVED');
        require(itemId < inquiryScopeCount[inquiryId], 'ClientLedger: INVALID_ITEM');
        require(!scopeItemCancelled[inquiryId][itemId], 'ClientLedger: ALREADY_CANCELLED');

        scopeItemCancelled[inquiryId][itemId] = true;
        emit ScopeItemCancelled(inquiryId, itemId);
    }

    // Client signals their scope buildout is complete and ready for admin review.
    function markReadyForReview(uint256 inquiryId) external {
        Inquiry storage inq = _inquiries[inquiryId];
        require(inq.client == msg.sender,        'ClientLedger: NOT_CLIENT');
        require(!inq.accepted && !inq.declined,  'ClientLedger: ALREADY_RESOLVED');
        require(!inq.readyForReview,             'ClientLedger: ALREADY_READY');
        inq.readyForReview = true;
        emit InquiryReadyForReview(inquiryId);
    }

    // Either party proposes a line item. The other must confirm before it is active.
    function proposeLineItem(
        uint256 projectId,
        string calldata description,
        uint256 ethAmount
    ) external nonReentrant whenNotPaused {
        Project storage p = _projects[projectId];
        require(p.client != address(0),                                   'ClientLedger: NOT_FOUND');
        require(!p.cancelled,                                             'ClientLedger: CANCELLED');
        require(msg.sender == owner() || msg.sender == p.client,         'ClientLedger: NOT_PARTY');
        require(ethAmount > 0,                                            'ClientLedger: ZERO_AMOUNT');
        require(bytes(description).length > 0,                           'ClientLedger: EMPTY_DESCRIPTION');

        uint256 itemId = p.lineItemCount++;
        _lineItems[projectId][itemId] = LineItem({
            description:       description,
            ethAmount:         ethAmount,
            effectiveAmount:   ethAmount,
            proposedByOwner:   msg.sender == owner(),
            active:            false,
            ownerDone:         false,
            clientDone:        false,
            released:          false,
            removalProposed:   false,
            removalProposedBy: address(0),
            removed:           false
        });

        emit LineItemProposed(projectId, itemId, description, ethAmount);
    }

    // Counterparty of the proposer confirms scope. Applies referral credits and allocates funds.
    function confirmLineItem(uint256 projectId, uint256 itemId) external nonReentrant whenNotPaused {
        Project storage p    = _projects[projectId];
        LineItem storage item = _lineItems[projectId][itemId];

        require(p.client != address(0),          'ClientLedger: NOT_FOUND');
        require(!p.cancelled,                    'ClientLedger: CANCELLED');
        require(!item.active && !item.removed,   'ClientLedger: INVALID_STATE');
        require(item.ethAmount > 0,              'ClientLedger: ITEM_NOT_FOUND');

        if (item.proposedByOwner) {
            require(msg.sender == p.client, 'ClientLedger: NOT_CLIENT');
        } else {
            require(msg.sender == owner(),  'ClientLedger: NOT_OWNER');
        }

        // Apply referral credits - reduces how much of the deposited balance is consumed
        uint256 credits     = clientProfiles[p.client].referralCredits;
        uint256 creditsUsed = credits >= item.ethAmount ? item.ethAmount : credits;
        uint256 effective   = item.ethAmount - creditsUsed;

        require(p.deposited - p.allocated >= effective, 'ClientLedger: INSUFFICIENT_FUNDS');

        clientProfiles[p.client].referralCredits -= creditsUsed;
        item.effectiveAmount = effective;
        item.active          = true;
        p.allocated         += effective;

        emit LineItemConfirmed(projectId, itemId, effective);
    }

    // Either party confirms work is done on an active item. Release fires when both confirm.
    function confirmWorkDone(uint256 projectId, uint256 itemId) external nonReentrant whenNotPaused {
        Project storage p    = _projects[projectId];
        LineItem storage item = _lineItems[projectId][itemId];

        require(p.client != address(0),                           'ClientLedger: NOT_FOUND');
        require(item.active && !item.released && !item.removed,   'ClientLedger: INVALID_STATE');
        require(msg.sender == owner() || msg.sender == p.client,  'ClientLedger: NOT_PARTY');

        if (msg.sender == owner()) {
            require(!item.ownerDone,  'ClientLedger: ALREADY_CONFIRMED');
            item.ownerDone = true;
        } else {
            require(!item.clientDone, 'ClientLedger: ALREADY_CONFIRMED');
            item.clientDone = true;
        }

        emit WorkConfirmed(projectId, itemId, msg.sender);

        if (item.ownerDone && item.clientDone) {
            _releaseItem(projectId, itemId);
        }
    }

    function _releaseItem(uint256 projectId, uint256 itemId) internal {
        Project storage p    = _projects[projectId];
        LineItem storage item = _lineItems[projectId][itemId];

        item.released  = true;
        p.allocated   -= item.effectiveAmount;
        p.released    += item.effectiveAmount;

        uint256 fee      = feeBps > 0 ? (item.effectiveAmount * feeBps) / 10000 : 0;
        uint256 ownerEth = item.effectiveAmount - fee;

        if (fee > 0 && feeRecipient != address(0)) {
            (bool feeOk,) = feeRecipient.call{value: fee}("");
            require(feeOk, 'ClientLedger: FEE_FAILED');
        } else {
            ownerEth = item.effectiveAmount;
        }

        if (ownerEth > 0) {
            (bool ok,) = owner().call{value: ownerEth}("");
            require(ok, 'ClientLedger: TRANSFER_FAILED');
        }

        emit LineItemReleased(projectId, itemId, ownerEth, fee);
    }

    // =========================================================================
    // LINE ITEM REMOVAL (mutual agreement)
    // =========================================================================

    function proposeRemoveLineItem(uint256 projectId, uint256 itemId) external nonReentrant {
        Project storage p    = _projects[projectId];
        LineItem storage item = _lineItems[projectId][itemId];

        require(p.client != address(0),                          'ClientLedger: NOT_FOUND');
        require(item.active && !item.released && !item.removed,  'ClientLedger: INVALID_STATE');
        require(!item.removalProposed,                           'ClientLedger: REMOVAL_PENDING');
        require(msg.sender == owner() || msg.sender == p.client, 'ClientLedger: NOT_PARTY');

        item.removalProposed   = true;
        item.removalProposedBy = msg.sender;

        emit RemovalProposed(projectId, itemId, msg.sender);
    }

    function confirmRemoveLineItem(uint256 projectId, uint256 itemId) external nonReentrant {
        Project storage p    = _projects[projectId];
        LineItem storage item = _lineItems[projectId][itemId];

        require(p.client != address(0),         'ClientLedger: NOT_FOUND');
        require(item.removalProposed,           'ClientLedger: NO_REMOVAL_PROPOSED');
        require(!item.removed,                  'ClientLedger: ALREADY_REMOVED');

        if (item.removalProposedBy == owner()) {
            require(msg.sender == p.client, 'ClientLedger: NOT_CLIENT');
        } else {
            require(msg.sender == owner(),  'ClientLedger: NOT_OWNER');
        }

        item.removed  = true;
        p.allocated  -= item.effectiveAmount;

        emit LineItemRemoved(projectId, itemId);
    }

    // =========================================================================
    // READ
    // =========================================================================

    function getInquiry(uint256 inquiryId) external view returns (
        address client,
        uint256 depositAmount,
        bool    accepted,
        bool    declined,
        uint256 projectId,
        bool    readyForReview
    ) {
        Inquiry storage inq = _inquiries[inquiryId];
        return (inq.client, inq.deposit, inq.accepted, inq.declined, inq.projectId, inq.readyForReview);
    }

    function getProject(uint256 projectId) external view returns (
        address client,
        string memory description,
        uint256 deposited,
        uint256 allocated,
        uint256 released,
        uint256 available,
        bool    financed,
        uint256 lineItemCount,
        bool    cancelled
    ) {
        Project storage p = _projects[projectId];
        return (
            p.client,
            p.description,
            p.deposited,
            p.allocated,
            p.released,
            p.deposited - p.allocated,
            p.financed,
            p.lineItemCount,
            p.cancelled
        );
    }

    function getLineItem(uint256 projectId, uint256 itemId) external view returns (
        string memory description,
        uint256 ethAmount,
        uint256 effectiveAmount,
        bool    active,
        bool    ownerDone,
        bool    clientDone,
        bool    released,
        bool    removalProposed,
        bool    removed
    ) {
        LineItem storage item = _lineItems[projectId][itemId];
        return (
            item.description,
            item.ethAmount,
            item.effectiveAmount,
            item.active,
            item.ownerDone,
            item.clientDone,
            item.released,
            item.removalProposed,
            item.removed
        );
    }

    function getClientProfile(address client) external view returns (
        address referredBy,
        uint256 referralCredits,
        bool    registered
    ) {
        ClientProfile storage cp = clientProfiles[client];
        return (cp.referredBy, cp.referralCredits, cp.registered);
    }

    // =========================================================================
    // ADMIN
    // =========================================================================

    function setDebtToken(address _debtToken) external onlyOwner {
        debtToken = _debtToken;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        feeRecipient = _feeRecipient;
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, 'ClientLedger: FEE_TOO_HIGH');
        feeBps = _feeBps;
    }

    function setInquiryDeposit(uint256 _amount) external onlyOwner {
        inquiryDeposit = _amount;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    receive() external payable {}
}
