/**
 * A share link: the app's address, /w/, then ten letters and digits — short enough to read
 * out in a class, and with 36¹⁰ ≈ 3.7·10¹⁵ of them far too many to guess one.
 */

export const SHARE_ID_LENGTH = 10;
export const SHARE_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export const SHARE_ID_PATTERN = /^[a-z0-9]{10}$/;

export function isShareId(s: string): boolean {
  return SHARE_ID_PATTERN.test(s);
}

/** The page a share link opens: /w/<id>. */
export function sharePath(id: string): string {
  return `/w/${id}`;
}

/** The id in a path or a whole link (with or without a trailing slash), or a bare id; null if there is none. */
export function shareIdFrom(link: string): string | null {
  const s = link.trim();
  if (isShareId(s)) return s;
  const m = /(?:^|\/)w\/([a-z0-9]{10})\/?(?:[?#].*)?$/.exec(s);
  return m ? m[1] : null;
}
