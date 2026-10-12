const encoder = new TextEncoder();
export function hex(bytes: Uint8Array): string { return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join(""); }
export async function digest(value: string): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value)))); }
export async function passwordHash(password: string, saltHex: string, pepper: string): Promise<string> {
  if(!/^[a-f0-9]{64}$/.test(saltHex) || pepper.length<32) throw new Error("Invalid credential configuration");
  const pepperKey = await crypto.subtle.importKey("raw",encoder.encode(pepper),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const prehash = await crypto.subtle.sign("HMAC",pepperKey,encoder.encode(password));
  const key = await crypto.subtle.importKey("raw",prehash,"PBKDF2",false,["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g)!,v=>parseInt(v,16));
  return hex(new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"},key,256)));
}
export function sameHash(a: string,b: string): boolean { if(a.length!==64 || b.length!==64) return false; let difference=0;for(let i=0;i<64;i++) difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0; }
export function sessionToken(): string { return hex(crypto.getRandomValues(new Uint8Array(32))); }
