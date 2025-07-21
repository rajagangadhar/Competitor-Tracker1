import { db } from './config/firebaseAdmin.js';

async function test() {
  const ref = db.collection('test').doc('hello');
  await ref.set({ message: 'Firebase connected successfully', time: new Date() });
  console.log('Document written successfully!');
}

test().catch(console.error);
