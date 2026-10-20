<script setup lang="ts">
import MobileSetup from '../components/MobileSetup.vue';
definePage({ meta: { title: '使用指引', description: '完成首次连接，了解工作流安装、运行和问题反馈。' } });
</script>
<template>
  <div class="space-y-4">
  <MobileSetup />
  <section class="rounded-card border border-line bg-surface p-4">
    <h2 class="text-sm font-semibold">连接前需要做什么</h2>
    <ol class="mt-4 space-y-4 text-sm leading-5 text-ink-secondary" role="list">
      <li><h3 class="font-medium text-ink">1. 初始化连接环境</h3>在「设备与运行」点击「初始化连接组件」。手机设置中开启「开发者选项 → USB 调试」，连接电脑后在手机上允许调试。</li>
      <li><h3 class="font-medium text-ink">2. 安装与选择工作流</h3>在「工作流商店」选择来源，或点击「添加 Registry」填写 GitHub 仓库地址。私有仓库需可访问该仓库的只读令牌。同步后安装工作流，再回到「设备与运行」选择。</li>
      <li><h3 class="font-medium text-ink">3. 准备手机并运行</h3>保持手机解锁，按工作流说明准备目标应用。发送示例的目标是「文件传输助手」，内容为「1」。新安装的发送工作流默认演练，填写核对后清理草稿，不点击发送。批量发送请先点击「配置」，填写消息或设置接口、勾选会话或选择全部，再核对范围与演练开关。企业微信使用原生控件，无需模型或截图授权。微信原生控件无法读取时，可先在「模型设置」配置并测试图像接口，再为该工作流选择「视觉 AI」。勾选一台或多台已授权手机，也可全选，然后点击「运行工作流」。最多同时运行 4 台，同一手机任务依次执行；一台失败不影响其他手机。运行期间请暂时不要操作所选手机。</li>
      <li><h3 class="font-medium text-ink">4. 查看结果与反馈问题</h3>在「运行结果」选择手机，查看对应的输出、错误与截图。在「运行记录」按手机序列号查看步骤日志；可多选后导出 JSON，发给开发者定位问题。清理前会再次确认。</li>
      <li><h3 class="font-medium text-ink">5. 配置定时任务</h3>在「定时任务」新建任务，选择已安装工作流与多台手机，填写五段 Cron 和时区，可先预览接下来 5 次执行时间。任务保存时固定工作流版本和输入、Hook、执行方式与演练配置。修改工作流配置后，需要编辑任务并勾选更新快照再保存。支持暂停、编辑、立即执行和按任务查看日志。保持客户端运行、电脑唤醒及手机连接；退出或休眠错过的时点不补跑，同一任务尚未结束时跳过并记录；同一手机的不同任务排队执行。</li>
    </ol>
    <p class="mt-4 border-t border-line pt-4 text-xs leading-5 text-ink-muted">仍找不到手机？换一根能传输数据的数据线或 USB 接口。Windows 部分手机需要品牌官方 USB 驱动。全部配置和记录保存在本机，无需部署后端服务。</p>
  </section>
  </div>
</template>
