import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const projectId = import.meta.env.PUBLIC_WALLET_CONNECT

const hoodi = {
  id:        167013,
  name:      'Hoodi Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.hoodi.taiko.xyz'] },
    public:  { http: ['https://rpc.hoodi.taiko.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Hoodi Explorer', url: 'https://explorer.hoodi.taiko.xyz' },
  },
  testnet: true,
}

const networks = [hoodi]

export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks,
  ssr: true
})

const queryClient = new QueryClient()

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata: {
    name: 'Justin - IT & Web',
    description: 'Local IT & web services. Jacksonville, FL.',
    url: typeof window !== 'undefined' ? window.location.origin : '',
    icons: []
  },
  defaultNetwork: hoodi,
  allowUnsupportedChain: false,
  features: {
    analytics: false,
    email:     false,
    socials:   false,
    swaps:     false,
  },
  themeMode: 'light',
  themeVariables: {
    '--w3m-accent':                '#f59e0b',
    '--w3m-border-radius-master':  '0px',
  }
})

export function WalletProvider({ children }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
