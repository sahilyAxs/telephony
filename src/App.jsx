import Call from './Call'

function App() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        backgroundColor: 'white',
        borderRadius: '20px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        overflow: 'hidden'
      }}>
        <Call />
      </div>
      <div style={{
        textAlign: 'center',
        marginTop: '20px',
        color: 'white',
        fontSize: '14px',
        opacity: 0.8
      }}>
        <p>WebRTC Voice Call Application | Check console for detailed logs (F12)</p>
      </div>
    </div>
  )
}

export default App