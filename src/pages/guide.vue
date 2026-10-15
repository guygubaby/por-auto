<script setup lang="ts">
definePage({ meta: { title: '使用指引', description: '完成首次连接，了解工作流安装、运行和问题反馈。' } });
</script>
<template>
  <section class="rounded-card border border-line bg-surface p-5">
    <h2 class="text-sm font-semibold">连接前需要做什么</h2>
    <ol class="mt-5 space-y-6 text-sm leading-7 text-ink-secondary" role="list">
      <li><h3 class="font-medium text-ink">1. 初始化连接环境</h3>在「设备与运行」点击「初始化连接组件」。手机设置中开启「开发者选项 → USB 调试」，连接电脑后在手机上允许调试。</li>
      <li><h3 class="font-medium text-ink">2. 安装与选择工作流</h3>在「工作流商店」填写 GitHub 仓库地址。私有仓库需可访问该仓库的只读令牌。刷新后安装工作流，再回到「设备与运行」选择。</li>
      <li><h3 class="font-medium text-ink">3. 准备手机并运行</h3>保持手机解锁，按工作流说明准备目标应用。选择已授权手机，点击「运行工作流」。运行期间请暂时不要操作手机。</li>
      <li><h3 class="font-medium text-ink">4. 查看结果与反馈问题</h3>在「运行结果」查看输出与截图。在「运行记录」查看步骤日志；可多选后导出 JSON，发给开发者定位问题。清理前会再次确认。</li>
    </ol>
    <p class="mt-5 border-t border-line pt-4 text-xs leading-6 text-ink-muted">仍找不到手机？换一根能传输数据的数据线或 USB 接口。Windows 部分手机需要品牌官方 USB 驱动。全部配置和记录保存在本机，无需部署后端服务。</p>
  </section>
</template>
