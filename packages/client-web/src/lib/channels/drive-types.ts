// Welle WV.D.5 — Cloud-Drive-Provider-Abstraktion (Types).
//
// Konzept §13.3 (Drive-Bridge) + plan-welle-d.md §4.3.
//
// Eigenes Interface neben ChannelProviderImpl: Drive-Provider haben
// ein File-zentriertes Pattern (listFolders/listFiles/getDownloadUrl)
// statt eines Message-Patterns. UI-Component DriveWidget rendert
// Folder-Tree + File-Liste; Drag-Source erzeugt Cell-Link-Atom (USP).

import type { ChannelProvider } from '../types';

export type DriveFolder = {
  id: string;
  name: string;
  // Voller Provider-Pfad (z.B. „/Documents/Projekte/Matrix"). V1 nicht
  // zwingend gesetzt — manche Provider liefern nur path-Segments.
  path?: string;
  // Parent-Ref fuer Tree-Render. null = root.
  parentId?: string | null;
};

export type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  modifiedAt?: string; // ISO-Timestamp
  // View-URL: Browser-Open im Provider-UI (z.B. OneDrive-Web).
  viewUrl?: string;
  // Download-URL: pre-signed URL fuer direkten Download. Lifetime
  // provider-abhaengig — Caller sollte sofort verwenden, nicht cachen.
  downloadUrl?: string;
  // Optional: Thumbnail-URL fuer Image/PDF-Preview.
  thumbnailUrl?: string;
  // Provider-Folder-Ref (Pfad-Anker fuer „Im Ordner zeigen"-Action).
  parentFolderId?: string | null;
};

export interface DriveProviderImpl {
  provider: ChannelProvider;

  // Liste der Folders. parentId=undefined → Root-Folders. parentId=string
  // → Sub-Folders unter dem Parent. V1 ohne Pagination — alles als Array.
  listFolders(parentId?: string): Promise<DriveFolder[]>;

  // Liste der Files in einem Folder. limit Default 50.
  listFiles(folderId: string, limit?: number): Promise<DriveFile[]>;

  // Frischt eine Download-URL on-demand (manche Provider expirieren die
  // URLs aus listFiles nach 1h). Caller (Drag-Source / Download-Button)
  // ruft das im Click-Handler und gibt die URL sofort weiter.
  getDownloadUrl(fileId: string): Promise<string | null>;

  // Test-Connect — verifiziert Token + ruft User-Profil ab.
  testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }>;
}
