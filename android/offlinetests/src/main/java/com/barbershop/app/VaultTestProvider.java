package com.barbershop.app;
import android.content.*;import android.database.Cursor;import android.net.Uri;import android.os.ParcelFileDescriptor;import java.io.*;
/** Private provider for synthetic encrypted file recovery checks only. */
public final class VaultTestProvider extends ContentProvider {
 public boolean onCreate(){return true;}
 public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{return ParcelFileDescriptor.open(new File(getContext().getFilesDir(),"synthetic-external.enc"),ParcelFileDescriptor.parseMode(mode));}
 public String getType(Uri uri){return "application/octet-stream";}
 public Cursor query(Uri u,String[] p,String s,String[] a,String o){return null;}
 public Uri insert(Uri u,ContentValues v){return null;}public int delete(Uri u,String s,String[] a){return 0;}public int update(Uri u,ContentValues v,String s,String[] a){return 0;}
}
