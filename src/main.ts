import './style.css';
import { Sandbox } from './sandbox/sandbox';

const app = document.getElementById('app')!;
const sandbox = new Sandbox(app);
// Handy for tuning from the browser console.
(window as unknown as { sandbox: Sandbox }).sandbox = sandbox;
sandbox.fire();
