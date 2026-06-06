// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

// Soulbound ERC-1155 debt token. One token type per project (tokenId = projectId).
// A client's balance represents their outstanding funded obligation.
// Minted when a line item is scope-confirmed. Burned when the item releases or is removed.
// Only ClientLedger can mint or burn.

contract DebtToken is ERC1155Upgradeable, OwnableUpgradeable, UUPSUpgradeable {

    address public ledger;

    mapping(uint256 => uint256) public totalSupply;
    mapping(uint256 => string)  private _tokenURIs;
    string private _baseTokenURI;

    event LedgerUpdated(address indexed ledger);
    event TokenURISet(uint256 indexed tokenId, string uri);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _ledger) initializer public {
        __ERC1155_init("");
        __Ownable_init(msg.sender);
        ledger = _ledger;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    modifier onlyLedger() {
        require(msg.sender == ledger, 'DebtToken: NOT_LEDGER');
        _;
    }

    function mint(address to, uint256 tokenId, uint256 amount) external onlyLedger {
        totalSupply[tokenId] += amount;
        _mint(to, tokenId, amount, "");
    }

    function burn(address from, uint256 tokenId, uint256 amount) external onlyLedger {
        totalSupply[tokenId] -= amount;
        _burn(from, tokenId, amount);
    }

    // Soulbound - block all transfers
    function safeTransferFrom(address, address, uint256, uint256, bytes memory) public pure override {
        revert('DebtToken: SOULBOUND');
    }

    function safeBatchTransferFrom(address, address, uint256[] memory, uint256[] memory, bytes memory) public pure override {
        revert('DebtToken: SOULBOUND');
    }

    // Per-token URI overrides the base. Owner can update at any lifecycle stage.
    function uri(uint256 tokenId) public view override returns (string memory) {
        string memory tokenURI = _tokenURIs[tokenId];
        if (bytes(tokenURI).length > 0) return tokenURI;
        return _baseTokenURI;
    }

    function setTokenURI(uint256 tokenId, string calldata tokenURI) external onlyOwner {
        _tokenURIs[tokenId] = tokenURI;
        emit TokenURISet(tokenId, tokenURI);
    }

    function setBaseURI(string calldata baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    // Holder can voluntarily burn their own token post-project as proof of closure.
    function selfBurn(uint256 tokenId) external {
        uint256 bal = balanceOf(msg.sender, tokenId);
        require(bal > 0, 'DebtToken: NO_BALANCE');
        totalSupply[tokenId] -= bal;
        _burn(msg.sender, tokenId, bal);
    }

    function setLedger(address _ledger) external onlyOwner {
        ledger = _ledger;
        emit LedgerUpdated(_ledger);
    }
}
