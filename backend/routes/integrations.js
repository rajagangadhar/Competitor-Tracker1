import express from 'express';
const router = express.Router();

// Example endpoint
router.get('/', (req, res) => {
  res.json({ message: 'Integrations route working' });
});

export default router;
