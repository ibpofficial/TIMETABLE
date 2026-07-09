import { Toaster } from 'sonner';
import { Wizard } from './components/Wizard';

export default function App() {
  return (
    <div className="min-h-screen">
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: {
            background: '#121832',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#e2e8f0',
          },
        }}
      />
      <Wizard />
    </div>
  );
}
