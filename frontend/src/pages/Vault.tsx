import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { ScrollArea } from '../components/ui/scroll-area';
import { Shield, Key, FileText, Star, Trash2, Plus, LogOut, Search } from 'lucide-react';
import { Input } from '../components/ui/input';
import ItemModal from '../components/ItemModal';

// Mock data model
export interface VaultItem {
  id: string;
  title: string;
  category: 'login' | 'document' | 'secure_note';
  username?: string;
  isFavorite?: boolean;
}

const mockItems: VaultItem[] = [
  { id: '1', title: 'Netflix', category: 'login', username: 'mario@example.com', isFavorite: true },
  { id: '2', title: 'Banca', category: 'login', username: 'mario.rossi' },
  { id: '3', title: 'Passaporto', category: 'document' },
];

export default function Vault() {
  const { logout } = useAuth();
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);

  const filteredItems = mockItems.filter(item => {
    if (activeCategory === 'favorites' && !item.isFavorite) return false;
    if (activeCategory === 'logins' && item.category !== 'login') return false;
    if (activeCategory === 'documents' && item.category !== 'document') return false;
    
    if (search && !item.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleOpenItem = (item?: VaultItem) => {
    setSelectedItem(item || null);
    setIsModalOpen(true);
  };

  return (
    <div className="flex h-screen bg-neutral-950 text-neutral-100 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-neutral-800 bg-neutral-900/50 flex flex-col">
        <div className="p-4 flex items-center gap-2 border-b border-neutral-800">
          <div className="bg-indigo-600 p-1.5 rounded-md">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">FamilyVault</span>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-2">
            <SidebarItem icon={<Shield />} label="Tutti gli elementi" active={activeCategory === 'all'} onClick={() => setActiveCategory('all')} />
            <SidebarItem icon={<Star />} label="Preferiti" active={activeCategory === 'favorites'} onClick={() => setActiveCategory('favorites')} />
            
            <div className="pt-4 pb-2 px-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Categorie</div>
            <SidebarItem icon={<Key />} label="Login" active={activeCategory === 'logins'} onClick={() => setActiveCategory('logins')} />
            <SidebarItem icon={<FileText />} label="Documenti" active={activeCategory === 'documents'} onClick={() => setActiveCategory('documents')} />
          </nav>
        </div>

        <div className="p-4 border-t border-neutral-800">
          <Button variant="ghost" className="w-full justify-start text-neutral-400 hover:text-white hover:bg-neutral-800" onClick={logout}>
            <LogOut className="w-4 h-4 mr-2" /> Blocca
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-neutral-800 bg-neutral-900/30 flex items-center justify-between px-6">
          <div className="relative w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <Input 
              placeholder="Cerca nel vault..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-neutral-900 border-neutral-800 text-neutral-100 focus-visible:ring-indigo-500 rounded-full" 
            />
          </div>
          <Button onClick={() => handleOpenItem()} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full px-6">
            <Plus className="w-4 h-4 mr-2" /> Nuovo
          </Button>
        </header>
        
        <ScrollArea className="flex-1 p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredItems.map(item => (
              <Card 
                key={item.id} 
                className="bg-neutral-900/80 border-neutral-800 hover:border-indigo-500/50 hover:bg-neutral-800 transition-all cursor-pointer group"
                onClick={() => handleOpenItem(item)}
              >
                <CardContent className="p-5 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0 group-hover:bg-indigo-600/20 group-hover:text-indigo-400 transition-colors">
                    {item.category === 'login' ? <Key className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                  </div>
                  <div className="overflow-hidden">
                    <h3 className="font-semibold text-neutral-200 truncate">{item.title}</h3>
                    {item.username && <p className="text-sm text-neutral-500 truncate">{item.username}</p>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {filteredItems.length === 0 && (
            <div className="flex flex-col items-center justify-center h-[50vh] text-neutral-500">
              <Shield className="w-16 h-16 mb-4 opacity-20" />
              <p>Nessun elemento trovato</p>
            </div>
          )}
        </ScrollArea>
      </main>

      {isModalOpen && (
        <ItemModal 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)} 
          item={selectedItem} 
        />
      )}
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm font-medium ${
        active 
          ? 'bg-indigo-600/10 text-indigo-400' 
          : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
      }`}
    >
      {React.cloneElement(icon as React.ReactElement, { className: 'w-4 h-4' })}
      {label}
    </button>
  );
}
