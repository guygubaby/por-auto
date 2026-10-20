'use strict';

var PACKAGE='com.por.auto.input',IME='com.por.auto.input/.PorInputMethod',LABEL='Por Auto 输入组件';
function selected(value){return value===IME||value===PACKAGE+'/'+PACKAGE+'.PorInputMethod';}
function setting(name){return String(android.provider.Settings.Secure.getString(context.getContentResolver(),name)||'');}
function hash(bytes){var value=java.security.MessageDigest.getInstance('SHA-256').digest(bytes),out='';for(var n=0;n<value.length;n++)out+=('0'+((value[n]+256)%256).toString(16)).slice(-2);return out;}
function state(){
  var artifact=require('./input-apk.js'),version=0,pm=context.getPackageManager(),info;
  try{info=pm.getPackageInfo(PACKAGE,android.content.pm.PackageManager.GET_SIGNATURES);}
  catch(error){if(String(error).indexOf('NameNotFoundException')<0)throw new Error('无法检查输入组件，请在系统设置确认安装状态');}
  if(info){
    if(!info.signatures||info.signatures.length!==1||hash(info.signatures[0].toByteArray())!==artifact.certificateSha256)throw new Error('输入组件签名不匹配，请从 Por Auto 重新安装');
    version=Number(info.versionCode);
  }
  var current=setting('default_input_method');
  return {installed:version>=artifact.versionCode,enabled:setting('enabled_input_methods').split(':').some(function(item){return selected(item.split(';')[0]);}),selected:selected(current),currentIme:current};
}
function install(){
  var artifact=require('./input-apk.js'),bytes=android.util.Base64.decode(artifact.base64,android.util.Base64.NO_WRAP);
  if(bytes.length!==artifact.size||hash(bytes)!==artifact.sha256)throw new Error('输入组件文件校验失败，请在商店更新工作流');
  var parent=context.getExternalFilesDir(null);if(!parent)throw new Error('手机安装文件目录不可用');
  var directory=new java.io.File(parent,'por-auto-components');if(!directory.isDirectory()&&!directory.mkdirs())throw new Error('无法准备输入组件目录');
  var destination=new java.io.File(directory,'por-input-'+artifact.versionCode+'.apk'),temporary=new java.io.File(directory,'por-input-'+String(java.util.UUID.randomUUID())+'.tmp');
  var output=new java.io.FileOutputStream(temporary);
  try{output.write(bytes);output.getFD().sync();}finally{output.close();}
  try{Packages.android.system.Os.rename(String(temporary.getPath()),String(destination.getPath()));}finally{temporary.delete();}
  app.viewFile(String(destination.getPath()));
}
function settings(){app.startActivity({action:android.provider.Settings.ACTION_INPUT_METHOD_SETTINGS});}
function pick(){context.getSystemService(android.content.Context.INPUT_METHOD_SERVICE).showInputMethodPicker();}
function ensureSelected(){
  var before=state();
  if(!before.installed||!before.enabled)throw new Error('请先在工作流「输入组件」中完成安装和启用，再运行发送工作流');
  if(before.selected)return null;
  pick();sleep(500);
  var windows=auto.service.getWindows(),kept=[],matches={};
  try{
    for(var w=0;w<windows.size();w++){
      var win=windows.get(w);if(!win.isFocused())continue;
      var root=win.getRoot();if(!root)continue;kept.push(root);
      var owner=String(root.getPackageName()),flags=context.getPackageManager().getApplicationInfo(owner,0).flags;
      if(!(flags&129)||owner===String(context.getPackageName()))continue;
      var found=root.findAccessibilityNodeInfosByText(LABEL);
      for(var n=0;n<found.size();n++){
        var node=found.get(n);kept.push(node);if(String(node.getText()||'')!==LABEL)continue;
        for(var depth=0;node&&depth<5;depth++){
          if(/(?:ListView|RecyclerView|ScrollView)$/.test(String(node.getClassName()||'')))break;
          if(node.isVisibleToUser()&&node.isEnabled()&&node.isClickable()){var bounds=new android.graphics.Rect();node.getBoundsInScreen(bounds);if(bounds.width()>0&&bounds.height()>0)matches[String(bounds)]=node;break;}
          node=node.getParent();if(node)kept.push(node);
        }
      }
    }
    var keys=Object.keys(matches);
    if(keys.length!==1)throw new Error('请在系统键盘选择框中选中「'+LABEL+'」，再重新运行');
    var row=matches[keys[0]],bounds=new android.graphics.Rect();
    if(!row.refresh()||!row.isVisibleToUser()||!row.isEnabled())throw new Error('系统键盘选择框已变化，未点击');
    row.getBoundsInScreen(bounds);
    if(bounds.left<0||bounds.top<0||bounds.right>device.width||bounds.bottom>device.height||bounds.width()<=0||bounds.height()<=0||!click(Math.floor(bounds.centerX()),Math.floor(bounds.centerY())))throw new Error('系统键盘选择未完成，请重新运行');
  }finally{kept.forEach(function(node){try{node.recycle();}catch(_){}});}
  for(var wait=0;wait<15;wait++){if(selected(setting('default_input_method')))return before.currentIme;sleep(200);}
  throw new Error('系统尚未选中输入组件，请完成键盘选择后重新运行');
}
function restore(previous){
  if(!previous||selected(previous)||!selected(setting('default_input_method')))return;
  state();
  var result=context.getContentResolver().call(android.net.Uri.parse('content://com.por.auto.input'),'restore',JSON.stringify({protocolVersion:1,previousIme:previous}),null);
  var value=result&&result.getString('result')!==null?JSON.parse(String(result.getString('result'))):null;
  if(!value||value.ok!==true)throw new Error('日常键盘未能恢复，请在系统键盘选择框中切换；未自动重试');
  for(var wait=0;wait<15;wait++){if(setting('default_input_method')===previous)return;sleep(200);}
  throw new Error('日常键盘恢复尚未完成，请手动选择原来的键盘');
}
module.exports={state:state,install:install,settings:settings,pick:pick,ensureSelected:ensureSelected,restore:restore};
