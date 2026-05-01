// Backup-Codes (B.2 Folge). 10 single-use Codes als TOTP-Fallback.
//
// Read: backup_codes_status liefert nur Counts, kein Hash.
// Mutations:
//   - generate_backup_codes: 10 neue Codes (loescht alte). Plain wird
//     EINMALIG zurueckgegeben — Frontend muss sie sofort anzeigen +
//     User auffordern zu kopieren/drucken.
//   - consume_backup_code: prueft Code-Hash + markiert used_at.
//     Wird im Login-MFA-Gate + Step-Up-Dialog als Alternative zum
//     6-stelligen TOTP-Code akzeptiert.

import { supabase } from './supabase';

export type BackupCodesStatus = {
  total: number;
  remaining: number;
  used: number;
};

export async function getBackupCodesStatus(): Promise<BackupCodesStatus> {
  const { data, error } = await supabase.rpc('backup_codes_status');
  if (error) throw error;
  return (data as BackupCodesStatus) ?? { total: 0, remaining: 0, used: 0 };
}

export async function generateBackupCodes(): Promise<string[]> {
  const { data, error } = await supabase.rpc('generate_backup_codes');
  if (error) throw error;
  return (data?.codes as string[]) ?? [];
}

export async function consumeBackupCode(code: string): Promise<{ remaining: number }> {
  const { data, error } = await supabase.rpc('consume_backup_code', {
    p_code: code,
  });
  if (error) throw error;
  return { remaining: (data?.remaining as number) ?? 0 };
}

// Helper: detektiert ob ein eingegebener String wie ein Backup-Code
// aussieht (12 Zeichen alphanumerisch + 2 Bindestriche), sonst wie
// 6-stelliger TOTP-Code. Login-Modal kann damit ohne Tab-Switch beide
// Inputs akzeptieren.
export function looksLikeBackupCode(input: string): boolean {
  const cleaned = input.trim().toUpperCase();
  return /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(cleaned);
}
