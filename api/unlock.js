const WINDOW_MS=60000;
async function hmac(secret,value){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value)));
}
async function codeFor(secret,w){
  const d=await hmac(secret,`protocol-lock:${w}`); let n=0; for(let i=0;i<4;i++) n=(n<<8)|d[i];
  return String((n>>>0)%1000000).padStart(6,"0");
}
async function sign(secret,p){
  const raw=Buffer.from(JSON.stringify(p)).toString("base64url"), s=Buffer.from(await hmac(secret,raw)).toString("base64url"); return `${raw}.${s}`;
}
export default async function handler(req,res){
  if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({error:"Method not allowed"});}
  const secret=process.env.LOCK_SESSION_SECRET; if(!secret)return res.status(500).json({error:"LOCK_SESSION_SECRET is not configured"});
  const code=String(req.body?.code||"").replace(/\D/g,"").slice(0,6); if(!/^\d{6}$/.test(code))return res.status(400).json({error:"Enter a 6-digit code"});
  const now=Date.now(), w=Math.floor(now/WINDOW_MS), valid=code===await codeFor(secret,w)||code===await codeFor(secret,w-1);
  if(!valid)return res.status(401).json({error:"Invalid or expired code"});
  const expiresAt=(w+1)*WINDOW_MS, token=await sign(secret,{scope:"protocol",exp:expiresAt});
  res.setHeader("Cache-Control","no-store"); return res.status(200).json({token,expiresAt});
}