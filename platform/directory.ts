/** Directorio de clientes y tiendas desde config/clients.yaml. */
import { join } from 'node:path';
import type { Client, DirectoryService, Scope } from './contracts.ts';
import { readYamlFile } from './util.ts';

export function loadClients(rootDir: string): Client[] {
  const raw = readYamlFile(join(rootDir, 'config', 'clients.yaml'));
  const clients: any[] = Array.isArray(raw?.clients) ? raw.clients : [];
  return clients.map((c) => ({
    id: String(c.id),
    name: String(c.name ?? c.id),
    sites: (Array.isArray(c.sites) ? c.sites : []).map((s: any) => ({
      id: String(s.id),
      name: String(s.name ?? s.id),
      city: String(s.city ?? ''),
      open: String(s.open ?? ''),
      close: String(s.close ?? ''),
    })),
  }));
}

export function createDirectory(rootDir: string): DirectoryService {
  const clients = loadClients(rootDir);

  const directory: DirectoryService = {
    clients: () => clients,
    client: (id) => clients.find((c) => c.id === id),
    site(id) {
      for (const client of clients) {
        const site = client.sites.find((s) => s.id === id);
        if (site) return { ...site, clientId: client.id, clientName: client.name };
      }
      return undefined;
    },
    describeScope(scope: Scope) {
      const site = scope.siteId ? directory.site(scope.siteId) : undefined;
      const clientId = scope.clientId ?? site?.clientId;
      const clientName = clientId ? (directory.client(clientId)?.name ?? clientId) : undefined;
      const siteName = scope.siteId ? (site?.name ?? scope.siteId) : undefined;
      const parts = [clientName, siteName].filter(Boolean);
      return parts.length ? parts.join(' · ') : 'Global';
    },
  };
  return directory;
}
