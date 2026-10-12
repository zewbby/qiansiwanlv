import React,{useEffect,useState,type FormEvent} from 'react';
import {createRoot} from 'react-dom/client';
import {Scissors,ArrowRight} from 'lucide-react';
import SalonApp from '../app/components/salon-app';
import {nativeCall,loadVault,initializeFromCloud} from '../lib/salon-offline-client';
import '../app/globals.css';
function App(){
 const [user,setUser]=useState<{displayName:string;email:string}|null>(null),[configured,setConfigured]=useState(false),[ready,setReady]=useState(false),[username,setUsername]=useState('admin'),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const locked=()=>{setUser(null);setPassword('')};window.addEventListener('salon-local-lock',locked);nativeCall<{configured:boolean;unlocked:boolean}>('info').then(async info=>{setConfigured(info.configured);if(info.unlocked){const vault=await loadVault();setUser(vault.view.user)}setReady(true)}).catch(e=>{setError(e.message);setReady(true)});return()=>window.removeEventListener('salon-local-lock',locked)},[]);
 async function login(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');try{
  if(configured)await nativeCall('unlock',{username,password});else{await nativeCall('cloudLogin',{username,password});await initializeFromCloud();setConfigured(true)}
  const vault=await loadVault();setPassword('');setUser(vault.view.user);
 }catch(e){setError(e instanceof Error?e.message:'无法登录，请重试')}finally{setBusy(false)}}
 if(user)return <SalonApp user={user}/>;
 return <main className="salon-login"><div className="salon-login-card"><span className="salon-login-mark"><Scissors size={36}/></span><h1>千丝万缕</h1><p>{configured?'解锁本地账本':'首次连接你的云端账本'}</p><form onSubmit={login}><label htmlFor="local-user">账号</label><input id="local-user" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} disabled={busy} required/><label htmlFor="local-pass">密码</label><input id="local-pass" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy} required/>{error&&<p role="alert" className="salon-login-error">{error}</p>}<button className="button primary" disabled={busy||!ready}><ArrowRight size={17}/>{busy?'处理中…':configured?'打开本地账本':'登录并下载现有账本'}</button></form><small>{configured?'没有网络也可以打开和记账':'首次使用请联网并开启 VPN，之后可离线使用'}</small><small>版本 1.1.0 · 本地保存 · 手动双向同步</small></div></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
