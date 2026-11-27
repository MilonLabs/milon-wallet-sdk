import { MilonWalletProvider } from '../../dist/index.js'

const openButton = document.querySelector('#open-button')
const closeButton = document.querySelector('#close-button')
const connectButton = document.querySelector('#connect-button')
const disconnectButton = document.querySelector('#disconnect-button')
const signForm = document.querySelector('#sign-form')
const signButton = document.querySelector('#sign-button')
const loginButton = document.querySelector('#login-button')
const message = document.querySelector('#message')
const accountStatus = document.querySelector('#account-status')
const requestStatus = document.querySelector('#request-status')
const result = document.querySelector('#result')

const provider = new MilonWalletProvider({
  walletUrl: 'https://wallet.milonlabs.com',
  network: ['devnet'],
  app: { title: 'Milon Connect Demo' },
})

let account = null
let pending = false

function updateButtons() {
  openButton.disabled = pending
  connectButton.disabled = pending
  disconnectButton.disabled = pending || !account
  signButton.disabled = pending || !account
  loginButton.disabled = pending || !account
}

function setAccount(connectedAccount) {
  account = connectedAccount
  accountStatus.textContent = account
    ? `${account.name || 'Connected account'} · ${account.address} · ${account.network}`
    : 'No account connected.'
  updateButtons()
}

function showResult(status, data) {
  requestStatus.textContent = status
  result.textContent = data === undefined ? '' : JSON.stringify(data, null, 2)
}

async function runRequest(label, request) {
  pending = true
  updateButtons()
  showResult(`${label} pending…`)

  try {
    showResult(`${label} completed.`, await request())
  } catch (error) {
    showResult(`${label} failed.`, {
      message: error instanceof Error ? error.message : 'Unexpected wallet error.',
    })
  } finally {
    pending = false
    updateButtons()
  }
}

provider.on('INIT', ({ account }) => setAccount(account))
provider.on('ACCOUNT_CHANGED', setAccount)
provider.on('DISCONNECTED', () => setAccount(null))
provider.init().catch((error) => {
  accountStatus.textContent = 'Wallet unavailable.'
  if (!pending) {
    showResult('Wallet initialization failed.', { message: error.message })
  }
})

openButton.addEventListener('click', () => {
  void runRequest('Open wallet', () => provider.open())
})

closeButton.addEventListener('click', () => {
  provider.close()
  if (pending) {
    requestStatus.textContent = 'Wallet window closed. A request is still pending.'
  } else {
    showResult('Wallet window closed.')
  }
})

connectButton.addEventListener('click', () => {
  void runRequest('Connect wallet', async () => {
    const connectedAccount = await provider.connect()
    setAccount(connectedAccount)
    return connectedAccount
  })
})

disconnectButton.addEventListener('click', () => {
  void runRequest('Disconnect wallet', async () => {
    const response = await provider.disconnect()
    setAccount(null)
    return response
  })
})

signForm.addEventListener('submit', (event) => {
  event.preventDefault()
  if (!signButton.disabled) {
    void runRequest('Sign message', () => provider.signMessage({ message: message.value }))
  }
})

loginButton.addEventListener('click', () => {
  void runRequest('Login request', () => provider.login({
    message: 'Sign in to Milon Connect Demo.',
    nonce: crypto.randomUUID(),
  }))
})

window.addEventListener('beforeunload', () => provider.destroy())
