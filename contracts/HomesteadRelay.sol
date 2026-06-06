// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITreasury {
    function trustedRelay() external view returns (address);
    function attestationTier(address wallet) external view returns (uint8);
}

interface IBurnableToken {
    function burnFrom(address account, uint256 amount) external;
}

interface IPair {
    function getReserves() external view returns (uint112 r0, uint112 r1);
    function token0() external view returns (address);
}

interface IMarketplace {
    function chargeSubsidy(address nftContract, uint256 tokenId, uint256 fee) external returns (bool);
}

contract HomesteadRelay is UUPSUpgradeable, OwnableUpgradeable {

    // =========================================================================
    // STORAGE — DO NOT REORDER OR DELETE EXISTING VARIABLES
    // Add new variables above __gap, reducing gap size accordingly.
    // =========================================================================

    address public treasury;
    address public feeToken;   // $BEER — burned on token path
    uint256 public quantumFee; // canonical fee in $BEER units (e.g. 1e18 = 1 $BEER)
    address public dexPair;    // $BEER/WETH pair — used to calculate ETH equivalent at send time

    // X25519 pubkey stored in state — 32 bytes, one slot, cheap lookup
    mapping(address => bytes32) public x25519Key;

    mapping(address => uint8)  public attestation;
    mapping(address => bool)   public isAttester;
    mapping(address => bool)   public registeredContract;
    mapping(address => bool)   public quantumFreeRecipient;

    struct Group {
        address creator;
        string  name;
        uint8   minTier;
        bool    active;
    }

    uint256 public groupCount;
    mapping(uint256 => Group)                    public groups;
    mapping(uint256 => address[])                public groupMembers;
    mapping(uint256 => mapping(address => bool)) public isMember;
    mapping(address => mapping(uint256 => bool)) public redeemed;

    // Marketplace address — used to check and charge quantum delivery message subsidies.
    address public marketplace;

    uint256[45] private __gap;

    // =========================================================================

    uint256 public constant VERSION  = 1;
    uint8   public constant TIER_NONE     = 0;
    uint8 public constant TIER_HOLDER   = 1;
    uint8 public constant TIER_BREWER   = 2;
    uint8 public constant TIER_VERIFIED = 3;

    // Kyber-768 pubkey (1184 bytes) emitted once on registration — clients cache per recipient
    event KeyRegistered(address indexed wallet, bytes32 x25519Key, bytes kyberKey);
    event AttestationSet(address indexed wallet, uint8 tier);
    event MessageSent(address indexed from, address indexed to, bytes encryptedPayload, bool quantumReady, uint256 timestamp);
    event GroupCreated(uint256 indexed groupId, address indexed creator, string name, uint8 minTier);
    event GroupJoined(uint256 indexed groupId, address indexed member);
    event GroupMessageSent(uint256 indexed groupId, address indexed from, bytes encryptedPayload, bool quantumReady, uint256 timestamp);
    event RedemptionRecorded(address indexed redeemer, address indexed token, uint256 indexed tokenId, uint256 timestamp);

    modifier onlyTrustedByTreasury() {
        require(ITreasury(treasury).trustedRelay() == address(this), "Relay: not trusted by Treasury");
        _;
    }

    modifier onlyAttester() {
        require(isAttester[msg.sender] || msg.sender == owner(), "Relay: not attester");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _treasury,
        address _feeToken,
        uint256 _quantumFee
    ) initializer public {
        __Ownable_init(msg.sender);
        treasury   = _treasury;
        feeToken   = _feeToken;
        quantumFee = _quantumFee;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // --- Key Registry ---

    function registerKey(bytes32 _x25519Key, bytes calldata _kyberKey) external {
        x25519Key[msg.sender] = _x25519Key;
        emit KeyRegistered(msg.sender, _x25519Key, _kyberKey);
    }

    // --- Attestation ---

    function setAttestation(address wallet, uint8 tier) external onlyAttester {
        attestation[wallet] = tier;
        emit AttestationSet(wallet, tier);
    }

    function addAttester(address attester) external onlyOwner {
        isAttester[attester] = true;
    }

    function removeAttester(address attester) external onlyOwner {
        isAttester[attester] = false;
    }

    // --- Fee Logic ---

    // Returns the ETH equivalent of quantumFee $BEER at current DEX spot price.
    // Only called when dexPair is set and the sender chooses the ETH path.
    function ethEquivalent() public view returns (uint256) {
        require(dexPair != address(0), "Relay: DEX_PAIR_NOT_SET");
        (uint112 r0, uint112 r1) = IPair(dexPair).getReserves();
        address t0 = IPair(dexPair).token0();
        // quantumFee is in $BEER units; derive ETH cost at spot
        return t0 == feeToken
            ? (quantumFee * uint256(r1)) / uint256(r0)   // r0=BEER r1=WETH
            : (quantumFee * uint256(r0)) / uint256(r1);  // r0=WETH r1=BEER
    }

    function _chargeQuantumFee(bool exempt) internal {
        if (msg.value > 0) {
            // ETH path — spot-priced against 1 $BEER unit, goes to Treasury floor
            require(msg.value >= ethEquivalent(), "Relay: INSUFFICIENT_ETH");
            (bool ok,) = treasury.call{value: msg.value}("");
            require(ok, "Relay: ETH_FAILED");
        } else if (!exempt) {
            // $BEER path — burned directly from sender (requires prior approval of this contract)
            IBurnableToken(feeToken).burnFrom(msg.sender, quantumFee);
        }
    }

    // --- 1:1 Messaging ---

    // Purchase coordination path — checks seller's subsidy before charging sender.
    // Buyer provides the NFT context; if the listing has remaining subsidy the seller's
    // pre-deposited $FARM is burned instead of charging the buyer.
    function sendDeliveryMessage(
        address to,
        bytes calldata encryptedPayload,
        bool quantumReady,
        address nftContract,
        uint256 tokenId
    ) external payable {
        require(x25519Key[to] != bytes32(0), "Relay: recipient has no key");
        if (quantumReady && quantumFee > 0) {
            bool subsidized = false;
            if (marketplace != address(0)) {
                try IMarketplace(marketplace).chargeSubsidy(nftContract, tokenId, quantumFee) returns (bool charged) {
                    subsidized = charged;
                } catch {}
            }
            if (!subsidized) {
                _chargeQuantumFee(quantumFreeRecipient[to]);
            }
        }
        emit MessageSent(msg.sender, to, encryptedPayload, quantumReady, block.timestamp);
    }

    function sendMessage(address to, bytes calldata encryptedPayload, bool quantumReady) external payable {
        if (quantumReady) {
            require(x25519Key[to] != bytes32(0), "Relay: recipient has no key");
            if (quantumFee > 0) {
                _chargeQuantumFee(quantumFreeRecipient[to]);
            }
        }
        emit MessageSent(msg.sender, to, encryptedPayload, quantumReady, block.timestamp);
    }

    // --- Group Threads ---

    function createGroup(string calldata name, uint8 minTier) external returns (uint256 groupId) {
        groupId = groupCount++;
        groups[groupId] = Group({ creator: msg.sender, name: name, minTier: minTier, active: true });
        groupMembers[groupId].push(msg.sender);
        isMember[groupId][msg.sender] = true;
        emit GroupCreated(groupId, msg.sender, name, minTier);
    }

    function joinGroup(uint256 groupId) external {
        Group storage g = groups[groupId];
        require(g.active, "Relay: group inactive");
        require(x25519Key[msg.sender] != bytes32(0), "Relay: register key first");
        require(!isMember[groupId][msg.sender], "Relay: already member");
        // Tier = higher of manual attestation or stake-derived tier from Treasury
        uint8 derived = ITreasury(treasury).attestationTier(msg.sender);
        uint8 effective = attestation[msg.sender] > derived ? attestation[msg.sender] : derived;
        require(effective >= g.minTier, "Relay: insufficient attestation");
        groupMembers[groupId].push(msg.sender);
        isMember[groupId][msg.sender] = true;
        emit GroupJoined(groupId, msg.sender);
    }

    function sendGroupMessage(uint256 groupId, bytes calldata encryptedPayload, bool quantumReady) external payable {
        require(isMember[groupId][msg.sender], "Relay: not a member");
        require(groups[groupId].active, "Relay: group inactive");
        if (quantumReady && quantumFee > 0) {
            _chargeQuantumFee(false);
        }
        emit GroupMessageSent(groupId, msg.sender, encryptedPayload, quantumReady, block.timestamp);
    }

    // --- QR Redemption ---

    function recordRedemption(address redeemer, address token, uint256 tokenId)
        external
        onlyTrustedByTreasury
    {
        require(registeredContract[msg.sender], "Relay: caller not registered");
        require(!redeemed[token][tokenId], "Relay: already redeemed");
        redeemed[token][tokenId] = true;
        emit RedemptionRecorded(redeemer, token, tokenId, block.timestamp);
    }

    // --- Contract Registry ---

    function registerContract(address contractAddr) external onlyOwner {
        registeredContract[contractAddr] = true;
    }

    function deregisterContract(address contractAddr) external onlyOwner {
        registeredContract[contractAddr] = false;
    }

    // --- Config ---

    function setTreasury(address _treasury)                        external onlyOwner { treasury                        = _treasury;    }
    function setFeeToken(address _feeToken)                        external onlyOwner { feeToken                        = _feeToken;    }
    function setQuantumFee(uint256 _fee)                           external onlyOwner { quantumFee                      = _fee;         }
    function setDexPair(address _dexPair)                          external onlyOwner { dexPair                         = _dexPair;     }
    function setQuantumFreeRecipient(address wallet, bool exempt)  external onlyOwner { quantumFreeRecipient[wallet]    = exempt;       }
    function setMarketplace(address _marketplace)                  external onlyOwner { marketplace                     = _marketplace; }
}
