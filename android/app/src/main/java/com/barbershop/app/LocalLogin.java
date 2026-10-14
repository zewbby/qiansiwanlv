package com.barbershop.app;
import java.io.IOException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import org.json.JSONObject;

/** Local authentication first; a verified same-store cloud login can replace stale credentials. */
final class LocalLogin {
 interface CloudAuthenticator { void authenticate(String username,String password)throws Exception; }
 static JSONObject login(LocalStore store,String username,String password,CloudAuthenticator cloud)throws Exception{
  if(username.isEmpty()||username.length()>100||password.isEmpty()||password.length()>256)throw new IOException("请输入有效的账号和密码");
  boolean configured=store.info().getBoolean("configured");
  if(configured){
   try{store.unlock(username,password);return new JSONObject().put("configured",true);}
   catch(LocalStore.AuthenticationException stale){/* Server still verifies the supplied password and enforces its own rate limit. */}
  }
  try{cloud.authenticate(username,password);}
  catch(SocketTimeoutException|UnknownHostException|SocketException e){throw new IOException("无法连接云端验证账号，请开启网络和 VPN 后重试；本地账本已保留",e);}
  return new JSONObject().put("configured",configured);
 }
}
