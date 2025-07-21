import express from 'express';
const router = express.Router();

// Example endpoint
router.get('/', (req, res) => {
  res.json({ message: 'Digest route working' });
});

export default router;
