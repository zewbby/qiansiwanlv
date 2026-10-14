package com.barbershop.app;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;

/** All screens are bundled; only the local origin receives the restricted native bridge. */
public final class MainActivity extends Activity {
 private static final String LOCAL="local.qiansiwanlv.invalid",CLOUD="https://qiansiwanlv-admin.qiansiwanlv-d64678.workers.dev";
 private WebView web;private LocalStore store;private final ExecutorService worker=Executors.newSingleThreadExecutor();private String pickerReply;private byte[] csv;
 @Override protected void onCreate(Bundle state){super.onCreate(state);getWindow().setStatusBarColor(Color.WHITE);getWindow().setNavigationBarColor(Color.WHITE);getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|(android.os.Build.VERSION.SDK_INT>=26?View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR:0));LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setFitsSystemWindows(true);setContentView(root);
  try{store=new LocalStore(this);}catch(Exception e){TextView error=new TextView(this);error.setPadding(30,50,30,30);error.setText("本地账本暂时无法读取，请保留应用数据并联系维护人员。不要卸载或清除数据。");root.addView(error);return;}
  web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,-1));WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(false);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setCacheMode(WebSettings.LOAD_NO_CACHE);s.setSupportMultipleWindows(false);android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);web.addJavascriptInterface(new Bridge(),"SalonNative");
  web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !local(r.getUrl());}@Override public boolean shouldOverrideUrlLoading(WebView v,String url){return !local(Uri.parse(url));}
   @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){Uri uri=r.getUrl();if(!local(uri))return blocked();String path=uri.getPath();if(path==null||path.contains("..")||path.contains("\\"))return blocked();if(path.equals("/")||path.equals("/login"))path="/index.html";
    try{String mime=path.endsWith(".html")?"text/html":path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":path.endsWith(".svg")?"image/svg+xml":path.endsWith(".png")?"image/png":"application/octet-stream";Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'");return new WebResourceResponse(mime,"utf-8",200,"OK",headers,getAssets().open("offline"+path));}catch(IOException e){return new WebResourceResponse("text/plain","utf-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}}
   @Override public void onReceivedSslError(WebView v,SslErrorHandler h,android.net.http.SslError e){h.cancel();}
  });web.loadUrl("https://"+LOCAL+"/?source=android");
 }
 private static boolean local(Uri u){return u!=null&&"https".equals(u.getScheme())&&LOCAL.equals(u.getHost())&&u.getUserInfo()==null&&(u.getPort()==-1||u.getPort()==443);}
 private static WebResourceResponse blocked(){return new WebResourceResponse("text/plain","utf-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
 private void reply(String id,Object value,String error){runOnUiThread(()->{if(web==null||!local(Uri.parse(web.getUrl()==null?"":web.getUrl())))return;try{JSONObject r=new JSONObject().put("ok",error==null);if(error==null)r.put("value",JSONObject.wrap(value));else r.put("error",error);web.evaluateJavascript("window.__salonReply&&window.__salonReply("+JSONObject.quote(id)+","+r+")",null);}catch(JSONException ignored){}});}
 private JSONObject request(String path,String method,JSONObject body,String cookie)throws Exception{boolean allowed=(path.equals("/api/auth/login")&&method.equals("POST"))||(path.equals("/api/sync")&&(method.equals("GET")||method.equals("POST")))||(path.equals("/api/sync/status")&&method.equals("GET"));if(!allowed)throw new IOException("不允许的云端请求");HttpURLConnection c=(HttpURLConnection)new URL(CLOUD+path).openConnection();c.setRequestMethod(method);c.setInstanceFollowRedirects(false);c.setConnectTimeout(12000);c.setReadTimeout(12000);c.setRequestProperty("Origin",CLOUD);c.setRequestProperty("Sec-Fetch-Site","same-origin");c.setRequestProperty("Cache-Control","no-store");if(!cookie.isEmpty())c.setRequestProperty("Cookie",cookie);
  try{if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes("UTF-8"));}}int status=c.getResponseCode();InputStream input=status<400?c.getInputStream():c.getErrorStream();if(input==null)throw new IOException("云端未返回内容");ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=input){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){bytes.write(b,0,n);if(bytes.size()>48000000)throw new IOException("云端账本过大");}}JSONObject result;try{result=new JSONObject(bytes.toString("UTF-8"));}catch(JSONException e){throw new IOException("云端响应异常，请检查 VPN 后重试");}return new JSONObject().put("status",status).put("body",result).put("cookie",c.getHeaderField("Set-Cookie")==null?"":c.getHeaderField("Set-Cookie").split(";")[0]);}finally{c.disconnect();}
 }
 private void cloudAuthenticate(String username,String password)throws Exception{if(username.length()>100||password.length()>256)throw new IOException("账号或密码过长");JSONObject login=request("/api/auth/login","POST",new JSONObject().put("username",username).put("password",password),"");if(login.getInt("status")!=200)throw new IOException(login.getJSONObject("body").optString("error","云端登录失败"));String cookie=login.getString("cookie");if(!cookie.startsWith("salon_session="))throw new IOException("云端登录凭证缺失");JSONObject check=request("/api/sync/status","GET",null,cookie);if(check.getInt("status")!=200)throw new IOException("云端账号验证失败");store.authenticated(username,password,cookie,check.getJSONObject("body").getString("storeId"));}
 public final class Bridge {@JavascriptInterface public void call(String id,String method,String raw){if(id==null||id.length()>100||raw==null||raw.length()>48000000)return;worker.execute(()->{try{JSONObject p=new JSONObject(raw);Object result;switch(method){
  case "info":result=store.info();break;
  case "unlock":store.unlock(p.getString("username"),p.getString("password"));result=true;break;
  case "login":result=LocalLogin.login(store,p.getString("username"),p.getString("password"),MainActivity.this::cloudAuthenticate);break;
  case "lock":store.lock();result=true;break;
  case "setAutoLogin":store.setAutoLogin(p.getBoolean("enabled"));result=true;break;
  case "cloudLogin":cloudAuthenticate(p.getString("username"),p.getString("password"));result=true;break;
  case "readVault":{JSONObject vault=store.readVault();JSONObject user=new JSONObject().put("displayName",store.info().getString("username")).put("email",store.info().getString("username"));vault.getJSONObject("view").put("user",user);if(vault.getJSONObject("base").has("data"))vault.getJSONObject("base").getJSONObject("data").put("user",new JSONObject(user.toString()));result=vault;break;}
  case "writeVault":result=store.writeVault(p.getJSONObject("vault"));break;
  case "storage":result=store.storage();break;
  case "defaultStorage":store.defaultDirectory();result=store.storage();break;
  case "cloud":store.requireUnlocked();result=request(p.getString("path"),p.getString("method"),p.optJSONObject("body"),store.cookie());((JSONObject)result).remove("cookie");break;
  case "chooseStorage":store.requireUnlocked();runOnUiThread(()->chooseDirectory(id));return;
  case "exportCsv":store.requireUnlocked();if(p.getString("csv").length()>8000000)throw new IOException("导出过大");String name=p.getString("name");if(!name.endsWith(".csv")||name.length()>160)throw new IOException("文件名不正确");byte[] bytes=p.getString("csv").getBytes("UTF-8");runOnUiThread(()->chooseCsv(id,name,bytes));return;
  default:throw new IOException("不支持的操作");}reply(id,result,null);
 }catch(Exception e){String message=e instanceof SocketTimeoutException?"云端未连接，请检查网络或 VPN；本地可继续使用":e instanceof javax.crypto.AEADBadTagException?"本地文件校验失败，请保留文件并联系维护人员":e instanceof IOException||e instanceof JSONException?e.getMessage():"本地操作未完成，请保留账本并重试";reply(id,null,message);}});}}
 private void chooseDirectory(String id){if(pickerReply!=null){reply(id,null,"已有文件选择操作，请先完成");return;}pickerReply=id;Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);try{startActivityForResult(i,42);}catch(Exception e){pickerReply=null;reply(id,null,"手机没有目录选择组件");}}
 private void chooseCsv(String id,String name,byte[] bytes){if(pickerReply!=null){reply(id,null,"请先完成目录选择");return;}pickerReply=id;csv=bytes;try{startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("text/csv").putExtra(Intent.EXTRA_TITLE,name.replace('/','_').replace('\\','_')),41);}catch(Exception e){pickerReply=null;csv=null;reply(id,null,"手机没有文件保存组件");}}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=41&&request!=42)return;String id=pickerReply;pickerReply=null;byte[] bytes=csv;csv=null;if(id==null)return;if(result!=RESULT_OK||data==null||data.getData()==null){reply(id,Collections.singletonMap("cancelled",true),null);return;}worker.execute(()->{try{if(request==42)store.changeDirectory(data.getData(),data.getFlags());else try(OutputStream out=getContentResolver().openOutputStream(data.getData())){if(out==null||bytes==null)throw new IOException("保存失败");out.write(bytes);}reply(id,new JSONObject().put("cancelled",false),null);}catch(Exception e){reply(id,null,"存放位置未切换，原账本已保留："+e.getMessage());}});}
 @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
 @Override protected void onDestroy(){worker.shutdown();if(web!=null){web.removeJavascriptInterface("SalonNative");web.destroy();web=null;}super.onDestroy();}
}

