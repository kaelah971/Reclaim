/**
 * ProtectedPaymentEscrow ABI — generated from the Foundry build artifact.
 *
 * Source artifact: contracts/out/ProtectedPaymentEscrow.sol/ProtectedPaymentEscrow.json
 * Regenerate with: npm run abi:export   (after `forge build` in contracts/)
 *
 * DO NOT EDIT BY HAND.
 */
export const protectedPaymentEscrowABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_stablecoin",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptPayment",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "approveRelease",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelUnfunded",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createPayment",
    "inputs": [
      {
        "name": "worker",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "agreementLabel",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "deliverableSummary",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "deliveryFormat",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "deliveryDeadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "releaseRule",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "autoReleaseSeconds",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "disputeWindowSeconds",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "evidenceExpectation",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "emergencyRescueToken",
    "inputs": [
      {
        "name": "_token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "escrowToken",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "fundPayment",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getClientPaymentIds",
    "inputs": [
      {
        "name": "client",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPayment",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ProtectedPaymentEscrow.Payment",
        "components": [
          {
            "name": "paymentId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "client",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "worker",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "agreementLabel",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deliverableSummary",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deliveryFormat",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "releaseRule",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "evidenceExpectation",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "termsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "evidenceReference",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "disputeReference",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deliveryDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "autoReleaseSeconds",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "disputeWindowSeconds",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "state",
            "type": "uint8",
            "internalType": "enum ProtectedPaymentEscrow.State"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "fundedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "acceptedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "deliveryAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "releaseRequestedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "releasedAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getWorkerPaymentIds",
    "inputs": [
      {
        "name": "worker",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "openDispute",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "disputeReference",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paymentCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "renounceOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requestRelease",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "resolveDispute",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "clientAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setPaused",
    "inputs": [
      {
        "name": "_paused",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitEvidenceHash",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "evidenceReference",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "ContractPaused",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ContractUnpaused",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DeliveryEvidenceSubmitted",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "evidenceReference",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentAccepted",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "worker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentCancelled",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "client",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentCreated",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "client",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "worker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "termsHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentDisputed",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "disputer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "disputeReference",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentFunded",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "client",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentReleased",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "client",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "worker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentResolved",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "resolver",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "client",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "worker",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "clientAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "workerAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ReleaseRequested",
    "inputs": [
      {
        "name": "paymentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "worker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyFunded",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ContractIsPaused",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EvidenceRequired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidState",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PaymentNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "TransferAmountMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnauthorizedClient",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnauthorizedWorker",
    "inputs": []
  }
] as const;
