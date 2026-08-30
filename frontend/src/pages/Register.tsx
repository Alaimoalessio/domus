import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { deriveKeys } from '../lib/crypto';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { ShieldCheck, Loader2, Printer, Copy, CheckCircle2 } from 'lucide-react';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Recovery kit state
  const [recoveryCode, setRecoveryCode] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  
  const navigate = useNavigate();

  const generateRecoveryCode = () => {
    // Generate a 16-character alphanumeric code for recovery
    const array = new Uint8Array(8);
    window.crypto.getRandomValues(array);
    const hex = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    return `${hex.slice(0,4)}-${hex.slice(4,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}`;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Le password non corrispondono');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const code = generateRecoveryCode();
      const { authKey, masterKey } = await deriveKeys(password, email);
      // Here you would encrypt the masterKey with a key derived from the recovery code
      // and send it to the server along with the authKey.
      
      setRecoveryCode(code);
    } catch (err: any) {
      setError(err.message || 'Errore durante la registrazione');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(recoveryCode);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const printRecoveryKit = () => {
    window.print();
  };

  if (recoveryCode) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg bg-neutral-900 border-neutral-800 text-neutral-100 shadow-2xl print:bg-white print:text-black print:shadow-none print:border-none">
          <CardHeader className="text-center space-y-4">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto print:hidden">
              <ShieldCheck className="w-8 h-8 text-green-500" />
            </div>
            <CardTitle className="text-2xl font-bold">Il tuo Kit di Emergenza</CardTitle>
            <CardDescription className="text-neutral-400 print:text-neutral-600 text-base">
              Questo codice è l'<strong>unico modo</strong> per recuperare i tuoi dati se dimentichi la Master Password. Salvalo in un luogo sicuro.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-neutral-950 print:bg-neutral-100 border border-neutral-800 print:border-neutral-300 p-6 rounded-xl text-center">
              <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2 font-semibold">Recovery Code</div>
              <div className="text-2xl font-mono tracking-[0.2em] font-bold text-indigo-400 print:text-indigo-700 select-all">
                {recoveryCode}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3 print:hidden">
            <div className="flex w-full gap-3">
              <Button onClick={copyToClipboard} variant="outline" className="w-full border-neutral-700 bg-neutral-800 hover:bg-neutral-700 hover:text-white transition-all">
                {isCopied ? <CheckCircle2 className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
                Copia
              </Button>
              <Button onClick={printRecoveryKit} variant="outline" className="w-full border-neutral-700 bg-neutral-800 hover:bg-neutral-700 hover:text-white transition-all">
                <Printer className="w-4 h-4 mr-2" /> Stampa PDF
              </Button>
            </div>
            <Button onClick={() => navigate('/login')} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white mt-4">
              Ho salvato il codice, vai al Login
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-neutral-900 border-neutral-800 text-neutral-100 shadow-2xl">
        <CardHeader className="space-y-1 flex flex-col items-center">
          <div className="w-12 h-12 bg-indigo-600/20 rounded-full flex items-center justify-center mb-2">
            <ShieldCheck className="w-6 h-6 text-indigo-500" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Crea il tuo Vault</CardTitle>
          <CardDescription className="text-neutral-400">
            Imposta una Master Password forte. Non potrà essere recuperata dal server.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleRegister}>
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
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-neutral-300">Conferma Master Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
                  Generazione chiavi in corso...
                </>
              ) : (
                'Crea Vault'
              )}
            </Button>
            <div className="text-sm text-center text-neutral-400">
              Hai già un account? <Link to="/login" className="text-indigo-400 hover:text-indigo-300 transition-colors">Accedi</Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
