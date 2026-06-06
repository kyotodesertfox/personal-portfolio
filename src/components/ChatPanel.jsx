import { useState, useEffect, useRef } from 'react';
import { usePublicClient, useWriteContract, useWaitForTransactionReceipt, useReadContract, useSignMessage } from 'wagmi';
import { parseAbiItem, keccak256 } from 'viem';
import nacl from 'tweetnacl';

const RELAY        = '0xc662fe2D2b887CE6647e81D971efd1d26B71e854';
const KEY_SIGN_MSG = 'HomesteadRelay key registration v1';
const ZERO_KEY     = '0x0000000000000000000000000000000000000000000000000000000000000000';

const RELAY_ABI = [
  { name: 'sendMessage', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'encryptedPayload', type: 'bytes' }, { name: 'quantumReady', type: 'bool' }],
    outputs: [],
  },
  { name: 'registerKey', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: '_x25519Key', type: 'bytes32' }, { name: '_kyberKey', type: 'bytes' }], outputs: [],
  },
  { name: 'x25519Key', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'bytes32' }] },
];

const MSG_EVENT = parseAbiItem('event MessageSent(address indexed from, address indexed to, bytes encryptedPayload, bool quantumReady, uint256 timestamp)');

function hexToBytes(hex) {
  return Uint8Array.from(Buffer.from(hex.slice(2), 'hex'));
}

function decodeMessage(payload, secured, privKey, isMine, theirKey) {
  const bytes = hexToBytes(payload);
  if (!secured) {
    try { return new TextDecoder().decode(bytes); } catch { return '[unreadable]'; }
  }
  if (!privKey) return '[Encrypted — unlock to read]';
  try {
    const nonce  = bytes.slice(32, 56);
    const cipher = bytes.slice(56);
    // Sent messages: peer is the recipient (use their registered key)
    // Received messages: peer is the sender (embedded in payload bytes 0-32)
    const peerPub = isMine ? hexToBytes(theirKey) : bytes.slice(0, 32);
    const plain   = nacl.box.open(cipher, nonce, peerPub, privKey);
    if (!plain) return '[Decryption failed]';
    return new TextDecoder().decode(plain);
  } catch {
    return '[Decryption error]';
  }
}

function MessagingGuide({ isAdmin, myKeyRegistered, theirKeyReg, secureAvailable, privKey, isSigning, isPending, pendingAction, onUpgrade, onUnlock, hasEncrypted }) {
  if (isAdmin) {
    // Admin: compact status only
    if (!myKeyRegistered) return (
      <div className="mb-3 bg-slate-50 border border-slate-200 px-4 py-3 flex items-center justify-between">
        <p className="text-xs text-slate-500">Register your key to enable secure messaging.</p>
        <button onClick={onUpgrade} disabled={isSigning || isPending} className="text-xs font-bold uppercase tracking-widest text-amber-500 hover:text-amber-600 disabled:opacity-40">
          {isSigning ? 'Sign...' : isPending ? 'Confirming...' : 'Register Key'}
        </button>
      </div>
    );
    if (!theirKeyReg) return (
      <div className="mb-3 bg-slate-50 border border-slate-200 px-4 py-3">
        <p className="text-xs text-slate-500">Waiting for client to enable secure messaging.</p>
      </div>
    );
    if (hasEncrypted && !privKey) return (
      <div className="mb-3 bg-amber-50 border border-amber-200 px-4 py-3 flex items-center justify-between">
        <p className="text-xs text-slate-600">Sign to unlock encrypted messages.</p>
        <button onClick={onUnlock} disabled={isSigning} className="text-xs font-bold uppercase tracking-widest text-amber-500 hover:text-amber-600 disabled:opacity-40">
          {isSigning ? 'Sign...' : 'Unlock'}
        </button>
      </div>
    );
    return null;
  }

  // Client: full step-by-step guide
  const steps = [
    {
      active: !myKeyRegistered,
      done: myKeyRegistered,
      label: 'Enable Secure Messaging',
      description: 'Your messages are currently unencrypted. Enable secure messaging to protect your conversation with end-to-end encryption. This requires one wallet signature and a small gas fee.',
      action: myKeyRegistered ? null : (
        <button onClick={onUpgrade} disabled={isSigning || (isPending && pendingAction === 'register')} className="mt-2 bg-slate-900 hover:bg-slate-700 text-white font-black uppercase tracking-widest text-xs px-4 py-2 transition-colors disabled:opacity-40">
          {isSigning ? 'Sign in wallet...' : (isPending && pendingAction === 'register') ? 'Confirming...' : '+ Enable Secure Messaging'}
        </button>
      ),
    },
    {
      active: myKeyRegistered && !theirKeyReg,
      done: theirKeyReg,
      label: 'Waiting on Support',
      description: 'Your key is registered. Waiting for the support side to complete setup before encryption is active.',
    },
    {
      active: secureAvailable && hasEncrypted && !privKey,
      done: secureAvailable && (!hasEncrypted || !!privKey),
      label: 'Unlock Your Messages',
      description: 'Both sides are set up. Sign with your wallet to derive your private key and decrypt your messages. This happens once per session — your key is never stored.',
      action: (secureAvailable && hasEncrypted && !privKey) ? (
        <button onClick={onUnlock} disabled={isSigning} className="mt-2 bg-slate-900 hover:bg-slate-700 text-white font-black uppercase tracking-widest text-xs px-4 py-2 transition-colors disabled:opacity-40">
          {isSigning ? 'Sign in wallet...' : 'Unlock Messages'}
        </button>
      ) : null,
    },
    {
      active: false,
      done: secureAvailable && (!hasEncrypted || !!privKey),
      label: 'End-to-End Encrypted',
      description: 'Your conversation is fully encrypted. Only you and support can read these messages.',
    },
  ];

  const currentStep = steps.findIndex(s => s.active);
  if (currentStep === -1 && steps[steps.length - 1].done) return (
    <div className="mb-3 bg-green-50 border border-green-200 px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-widest text-green-600 mb-0.5">End-to-End Encrypted</p>
      <p className="text-xs text-slate-500">Your conversation is fully encrypted. Only you and support can read these messages.</p>
    </div>
  );

  if (currentStep === -1) return null;

  const step = steps[currentStep];
  return (
    <div className="mb-3 bg-slate-50 border border-slate-200 px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Step {currentStep + 1} of {steps.length}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">{step.label}</span>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">{step.description}</p>
      {step.action}
    </div>
  );
}

export default function ChatPanel({ myAddress, otherAddress, otherLabel, isAdmin }) {
  const publicClient = usePublicClient();
  const [messages, setMessages]         = useState([]);
  const [input, setInput]               = useState('');
  const [loading, setLoading]           = useState(true);
  const [privKey, setPrivKey]           = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const bottomRef = useRef(null);

  const { data: myKey,    refetch: refetchMyKey } = useReadContract({ address: RELAY, abi: RELAY_ABI, functionName: 'x25519Key', args: [myAddress],    query: { enabled: !!myAddress } });
  const { data: theirKey }                        = useReadContract({ address: RELAY, abi: RELAY_ABI, functionName: 'x25519Key', args: [otherAddress], query: { enabled: !!otherAddress } });

  const myKeyRegistered = myKey    && myKey    !== ZERO_KEY;
  const theirKeyReg     = theirKey && theirKey !== ZERO_KEY;
  const secureAvailable = myKeyRegistered && theirKeyReg;

  const { signMessage, isPending: isSigning } = useSignMessage();
  const { writeContract, isPending, data: txHash, reset } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!isSuccess) return;
    reset();
    if (pendingAction === 'register') { refetchMyKey(); setPendingAction(null); }
    if (pendingAction === 'send')     { setInput(''); fetchMessages(); setPendingAction(null); }
  }, [isSuccess]);

  const derivePrivKey = (onDone) => {
    signMessage(
      { message: KEY_SIGN_MSG },
      {
        onSuccess: (sig) => {
          const seed = keccak256(sig);
          const pk   = hexToBytes(seed);
          setPrivKey(pk);
          onDone?.(pk);
        },
      }
    );
  };

  const handleUpgrade = () => {
    derivePrivKey((pk) => {
      const keyPair = nacl.box.keyPair.fromSecretKey(pk);
      const pubHex  = '0x' + Buffer.from(keyPair.publicKey).toString('hex');
      setPendingAction('register');
      writeContract({ address: RELAY, abi: RELAY_ABI, functionName: 'registerKey', args: [pubHex, '0x'] });
    });
  };

  const handleUnlock = () => derivePrivKey();

  const fetchMessages = async () => {
    if (!publicClient || !myAddress || !otherAddress) return;
    setLoading(true);
    try {
      const [sent, received] = await Promise.all([
        publicClient.getLogs({ address: RELAY, event: MSG_EVENT, args: { from: myAddress,    to: otherAddress }, fromBlock: 0n, toBlock: 'latest' }),
        publicClient.getLogs({ address: RELAY, event: MSG_EVENT, args: { from: otherAddress, to: myAddress    }, fromBlock: 0n, toBlock: 'latest' }),
      ]);
      const all = [...sent, ...received]
        .sort((a, b) => Number(a.args.timestamp) - Number(b.args.timestamp))
        .map(log => ({
          payload: log.args.encryptedPayload,
          secured: log.args.quantumReady,
          isMine:  log.args.from.toLowerCase() === myAddress.toLowerCase(),
          ts:      Number(log.args.timestamp),
        }));
      setMessages(all);
    } catch (e) {
      console.error('fetch messages', e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchMessages(); }, [myAddress, otherAddress]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendEncrypted = (pk, text) => {
    const senderKeyPair   = nacl.box.keyPair.fromSecretKey(pk);
    const recipientPubKey = hexToBytes(theirKey);
    const nonce           = nacl.randomBytes(24);
    const cipher          = nacl.box(new TextEncoder().encode(text), nonce, recipientPubKey, pk);
    const payload         = new Uint8Array([...senderKeyPair.publicKey, ...nonce, ...cipher]);
    const hexPayload      = '0x' + Buffer.from(payload).toString('hex');
    setPendingAction('send');
    writeContract({ address: RELAY, abi: RELAY_ABI, functionName: 'sendMessage', args: [otherAddress, hexPayload, true] });
  };

  const handleSend = () => {
    if (!input.trim()) return;

    if (secureAvailable) {
      if (privKey) {
        sendEncrypted(privKey, input.trim());
      } else {
        derivePrivKey((pk) => sendEncrypted(pk, input.trim()));
      }
    } else {
      const hexPayload = '0x' + Buffer.from(new TextEncoder().encode(input.trim())).toString('hex');
      setPendingAction('send');
      writeContract({ address: RELAY, abi: RELAY_ABI, functionName: 'sendMessage', args: [otherAddress, hexPayload, false] });
    }
  };

  const hasEncrypted = messages.some(m => m.secured);

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Messages</p>

      <MessagingGuide
        isAdmin={isAdmin}
        myKeyRegistered={myKeyRegistered}
        theirKeyReg={theirKeyReg}
        secureAvailable={secureAvailable}
        privKey={privKey}
        isSigning={isSigning}
        isPending={isPending}
        pendingAction={pendingAction}
        onUpgrade={handleUpgrade}
        onUnlock={handleUnlock}
        hasEncrypted={hasEncrypted}
      />

      <div className="bg-slate-50 border border-slate-100 h-48 overflow-y-auto p-3 space-y-2 mb-3">
        {loading && <p className="text-xs text-slate-400 text-center pt-4">Loading...</p>}
        {!loading && messages.length === 0 && (
          <p className="text-xs text-slate-400 text-center pt-4">No messages yet.</p>
        )}
        {messages.map((msg, i) => {
          const text = decodeMessage(msg.payload, msg.secured, privKey, msg.isMine, theirKey);
          return (
            <div key={i} className={`flex flex-col ${msg.isMine ? 'items-end' : 'items-start'}`}>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1 px-1">
                {msg.isMine ? 'You' : (otherLabel ?? `${otherAddress?.slice(0,6)}...${otherAddress?.slice(-4)}`)}
              </span>
              <div className={`max-w-[80%] px-3 py-2 text-xs ${
                msg.isMine
                  ? 'bg-amber-400 text-slate-900 font-medium'
                  : 'bg-white border border-slate-200 text-slate-700'
              }`}>
                {text}
                {msg.secured
                  ? <span className="ml-2 text-green-600">🔒</span>
                  : <span className="ml-2 text-amber-500">⚠️</span>
                }
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder={secureAvailable && privKey ? 'Type a message (encrypted)...' : 'Type a message...'}
          className="flex-1 border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-amber-400"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || (isPending && pendingAction === 'send')}
          className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-black uppercase tracking-widest text-xs px-4 py-2 transition-colors disabled:opacity-40"
        >
          {(isPending && pendingAction === 'send') ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
