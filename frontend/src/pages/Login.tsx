import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { deriveKeys } from '../lib/crypto';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { Lock, Loader2 } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // 1. Derive keys locally using Argon2id (Slow step)
      const { authKey, masterKey } = await deriveKeys(password, email);

      // 2. Call backend login endpoint (Mocking network request here)
      // In a real app: await fetch('/api/login', { method: 'POST', body: JSON.stringify({ email, authKey }) })
      const mockResponse = { ok: true, token: 'mock-jwt-token', userId: 'user-id-123' };
      
      if (!mockResponse.ok) {
        throw new Error('Credenziali non valide');
      }

      // 3. Store in volatile memory
      await login(mockResponse.token, mockResponse.userId, masterKey);
      
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Errore durante il login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-neutral-900 border-neutral-800 text-neutral-100 shadow-2xl">
        <CardHeader className="space-y-1 flex flex-col items-center">
          <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center mb-2">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Sblocca il Vault</CardTitle>
          <CardDescription className="text-neutral-400">
            Inserisci la tua Master Password. L'operazione richiederà qualche secondo.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-neutral-300">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="mario@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-neutral-950 border-neutral-800 text-white placeholder:text-neutral-500 focus-visible:ring-indigo-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-neutral-300">Master Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="bg-neutral-950 border-neutral-800 text-white placeholder:text-neutral-500 focus-visible:ring-indigo-500"
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button 
              type="submit" 
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white transition-all duration-200" 
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Decrittazione chiavi in corso...
                </>
              ) : (
                'Sblocca'
              )}
            </Button>
            <div className="text-sm text-center text-neutral-400">
              Non hai un account? <Link to="/register" className="text-indigo-400 hover:text-indigo-300 transition-colors">Crea Vault</Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
