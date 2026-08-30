import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { VaultItem } from '../pages/Vault';
import { Copy, Eye, EyeOff, FileUp, Loader2, Save, Trash2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { encryptString, decryptString, generateNonce } from '../lib/crypto';
import { bufferToBase64Url } from '../lib/crypto/base64';

interface ItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: VaultItem | null;
}

export default function ItemModal({ isOpen, onClose, item }: ItemModalProps) {
  const { masterKey } = useAuth();
  
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setTitle(item.title);
      setUsername(item.username || '');
      // In a real app, here we would fetch the encrypted details and decrypt them:
      // fetch(`/api/items/${item.id}`).then(res => decrypt(res))
      setPassword('decrypted_mock_password');
      setNotes('Note cifrate...');
    } else {
      setTitle('');
      setUsername('');
      setPassword('');
      setNotes('');
      setFile(null);
    }
  }, [item]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    
    // Auto-clear clipboard after 30 seconds for sensitive fields like password
    if (field === 'password') {
      setTimeout(() => {
        navigator.clipboard.readText().then(clipboardText => {
          if (clipboardText === text) {
            navigator.clipboard.writeText('');
          }
        }).catch(() => {});
      }, 30000);
    }

    setTimeout(() => setCopiedField(null), 2000);
  };

  const generatePassword = () => {
    const array = new Uint8Array(16);
    window.crypto.getRandomValues(array);
    setPassword(bufferToBase64Url(array).slice(0, 16) + 'Aa1!'); // Ensure complexity
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      if (selected.size > 20 * 1024 * 1024) { // 20 MB
        alert('File troppo grande (max 20MB)');
        return;
      }
      setFile(selected);
    }
  };

  const handleSave = async () => {
    if (!masterKey) return;
    setLoading(true);
    
    try {
      const itemId = item?.id || crypto.randomUUID(); // AAD
      
      // Encrypting fields
      const encPassword = await encryptString(masterKey, password, itemId);
      const encNotes = await encryptString(masterKey, notes, itemId);
      
      console.log('Encrypted payload ready to be sent:', {
        id: itemId,
        title,
        username,
        password_ciphertext: encPassword.ciphertext,
        password_nonce: encPassword.nonce,
        notes_ciphertext: encNotes.ciphertext,
        notes_nonce: encNotes.nonce,
        // File would be encrypted via encryptFile and sent as blob
      });

      // Simulate network request
      await new Promise(r => setTimeout(r, 800));
      
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] bg-neutral-900 border-neutral-800 text-white shadow-2xl overflow-hidden p-0">
        <DialogHeader className="p-6 pb-4 border-b border-neutral-800 bg-neutral-900/50">
          <DialogTitle className="text-xl">{item ? 'Modifica Elemento' : 'Nuovo Elemento'}</DialogTitle>
        </DialogHeader>
        
        <div className="p-6 space-y-5">
          <div className="space-y-2">
            <Label className="text-neutral-400">Titolo</Label>
            <Input 
              value={title} 
              onChange={e => setTitle(e.target.value)} 
              className="bg-neutral-950 border-neutral-800 focus-visible:ring-indigo-500" 
              placeholder="es. Google, Banca" 
            />
          </div>

          <div className="space-y-2">
            <Label className="text-neutral-400">Username</Label>
            <div className="flex gap-2">
              <Input 
                value={username} 
                onChange={e => setUsername(e.target.value)} 
                className="bg-neutral-950 border-neutral-800 focus-visible:ring-indigo-500" 
              />
              <Button type="button" variant="outline" size="icon" className="shrink-0 border-neutral-700 bg-neutral-800 hover:bg-neutral-700" onClick={() => copyToClipboard(username, 'username')}>
                {copiedField === 'username' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-neutral-400">Password</Label>
              <button type="button" onClick={generatePassword} className="text-xs text-indigo-400 hover:text-indigo-300">
                Genera
              </button>
            </div>
            <div className="flex gap-2 relative">
              <Input 
                type={showPassword ? 'text' : 'password'} 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                className="bg-neutral-950 border-neutral-800 focus-visible:ring-indigo-500 pr-10 font-mono" 
              />
              <button 
                type="button"
                className="absolute right-14 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <Button type="button" variant="outline" size="icon" className="shrink-0 border-neutral-700 bg-neutral-800 hover:bg-neutral-700" onClick={() => copyToClipboard(password, 'password')}>
                {copiedField === 'password' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-neutral-500">Copiando la password, gli appunti verranno svuotati dopo 30s per sicurezza.</p>
          </div>

          <div className="space-y-2">
            <Label className="text-neutral-400">Allegato (Max 20MB)</Label>
            <div className="flex gap-2">
              <Input 
                type="file" 
                onChange={handleFileChange} 
                className="bg-neutral-950 border-neutral-800 text-neutral-400 file:bg-neutral-800 file:text-white file:border-0 file:mr-4 file:px-4 file:py-1 file:rounded-md hover:file:bg-neutral-700 transition-all cursor-pointer" 
              />
            </div>
            {file && <p className="text-xs text-indigo-400">Verrà cifrato localmente prima dell'upload.</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-neutral-400">Note Sicure</Label>
            <textarea 
              value={notes} 
              onChange={e => setNotes(e.target.value)} 
              className="flex min-h-[80px] w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 text-white" 
            />
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-neutral-800 bg-neutral-900/50 flex items-center sm:justify-between">
          {item ? (
            <Button variant="ghost" className="text-red-500 hover:text-red-400 hover:bg-red-500/10">
              <Trash2 className="w-4 h-4 mr-2" /> Elimina
            </Button>
          ) : <div></div>}
          
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} className="hover:bg-neutral-800 hover:text-white">Annulla</Button>
            <Button onClick={handleSave} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Salva Cifrato
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
