import React,{useEffect,useState,type FormEvent} from 'react';
import {createRoot} from 'react-dom/client';
import {Scissors,ArrowRight} from 'lucide-react';
import SalonApp from '../app/components/salon-app';
import {nativeCall,loadVault,initializeFromCloud} from '../lib/salon-offline-client';
import '../app/globals.css';
function App(){
 const [user,setUser]=useState<{displayName:string;email:string}|null>(null),[configured,setConfigured]=useState(false),[ready,setReady]=useState(false),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[autoLogin,setAutoLogin]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const locked=()=>{setUser(null);setPassword('');setAutoLogin(false)};window.addEventListener('salon-local-lock',locked);nativeCall<{configured:boolean;unlocked:boolean;username:string;autoLogin:boolean}>('info').then(async info=>{setConfigured(info.configured);setUsername(info.username);setAutoLogin(info.autoLogin);if(info.unlocked){const vault=await loadVault();setUser(vault.view.user)}setReady(true)}).catch(e=>{setError(e.message);setReady(true)});return()=>window.removeEventListener('salon-local-lock',locked)},[]);
 async function login(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');try{
  const loginResult=await nativeCall<{configured:boolean}>('login',{username,password});if(!loginResult.configured){await initializeFromCloud();setConfigured(true)}
  const vault=await loadVault();await nativeCall('setAutoLogin',{enabled:autoLogin});setPassword('');setUser(vault.view.user);
 }catch(e){setError(e instanceof Error?e.message:'无法登录，请重试')}finally{setBusy(false)}}
 if(user)return <SalonApp user={user}/>;
 return <main className="salon-login"><div className="salon-login-card"><span className="salon-login-mark"><Scissors size={36}/></span><h1>千丝万缕</h1><p>店主管理端</p><form onSubmit={login}><label htmlFor="local-user">账号</label><input id="local-user" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} disabled={busy} required/><label htmlFor="local-pass">密码</label><input id="local-pass" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy} required/><label className="salon-auto-login"><input type="checkbox" checked={autoLogin} onChange={e=>setAutoLogin(e.target.checked)} disabled={busy||!ready}/><span>自动登录</span></label>{error&&<p role="alert" className="salon-login-error">{error}</p>}<button className="button primary" disabled={busy||!ready}><ArrowRight size={17}/>{busy?'正在登录…':'登录'}</button></form><small>{configured?'没有网络也可以登录和记账':'首次登录需要联网，之后可离线使用'}</small><small>版本 1.1.4</small></div></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
