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

    event LedgerUpdated(address indexed ledger);

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

    function setLedger(address _ledger) external onlyOwner {
        ledger = _ledger;
        emit LedgerUpdated(_ledger);
    }
}
