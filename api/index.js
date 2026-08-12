// Minimal Vercel function to debug startup errors
export default function handler(req, res) {
  try {
    // Test basic response first
    if (req.url === '/debug') {
      return res.status(200).json({ ok: true, node: process.version, env: Object.keys(process.env).filter(k => !k.includes('SECRET') && !k.includes('KEY') && !k.includes('PASS')) });
    }

    // Try to import the main app dynamically
    import('../server.js').then(mod => {
      const app = mod.app;
      app(req, res);
    }).catch(err => {
      res.status(500).json({ 
        error: 'Failed to load server.js', 
        message: err.message,
        stack: err.stack?.split('\n').slice(0, 5)
      });
    });
  } catch (err) {
    res.status(500).json({ 
      error: 'Handler crash', 
      message: err.message 
    });
  }
}
