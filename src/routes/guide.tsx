import { createFileRoute } from '@tanstack/react-router';
import {
  Cable,
  CheckCircle2,
  Download,
  ExternalLink,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { invoke, desktop } from '@/lib/bridge';
import {
  PageTitle,
  Panel,
  BusyButton,
  ErrorMessage,
} from '@/components/common';
import { Button } from '@/components/ui/button';
export const Route = createFileRoute('/guide')({ component: Guide });
function Guide() {
  const download = useMutation({
    mutationFn: (kind: string) =>
      kind === 'runtime'
        ? invoke('open_mobile_runtime')
        : invoke<string | null>('export_mobile_scripts', { kind }),
    onSuccess: (path) => {
      if (path) toast.success(`已保存到 ${path}`);
    },
  });
  return (
    <>
      <PageTitle
        title="使用指引"
        description="从连接设备到独立运行，一步一步开始。"
      />
      <div className="max-w-4xl space-y-6">
        <Panel
          title="连接 Android 手机"
          description="首次配置完成后，日常只需连接数据线。"
        >
          <ol className="space-y-6">
            {[
              {
                title: '开启开发者选项',
                description:
                  '进入手机设置，连续点击系统版本号，开启开发者选项。',
                icon: Smartphone,
              },
              {
                title: '开启 USB 调试并连接电脑',
                description:
                  '使用可传输数据的数据线连接手机，在开发者选项中开启 USB 调试。',
                icon: Cable,
              },
              {
                title: '允许此电脑连接',
                description:
                  '在手机弹窗中确认授权，保持屏幕解锁，回到工作台刷新设备。',
                icon: CheckCircle2,
              },
            ].map((step, i) => (
              <li className="flex gap-4" key={step.title}>
                <span className="bg-muted text-primary grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-sm font-medium">{step.title}</h3>
                  <p className="text-muted-foreground mt-1 text-sm leading-6">
                    {step.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="bg-muted text-muted-foreground mt-6 rounded-lg px-4 py-3 text-xs leading-5">
            Windows 部分设备需要品牌官方 USB 驱动。找不到设备时，可更换数据线或
            USB 接口，并检查手机授权。
          </p>
        </Panel>
        <Panel
          title="在手机上独立运行"
          description="电脑端和手机端可各自运行。手机端使用 AutoJs6 工作流商店。"
        >
          <ErrorMessage error={download.error} />
          <div className="space-y-5">
            {[
              {
                title: '安装官方 AutoJs6',
                description:
                  '在 Android 手机上安装运行环境，首次运行开启无障碍服务。',
                kind: 'runtime',
                label: '官方下载',
              },
              {
                title: '导入工作流商店启动脚本',
                description: '保存后传到手机，在 AutoJs6 中导入并运行。',
                kind: 'launcher',
                label: '保存启动脚本',
              },
              {
                title: '安装手机工作流',
                description:
                  '在商店同步来源或导入离线包，安装企业微信工作流。',
                kind: 'workflows',
                label: '保存离线工作流包',
              },
            ].map((v) => (
              <div
                key={v.kind}
                className="flex flex-wrap items-center justify-between gap-4 border-b pb-5 last:border-0 last:pb-0"
              >
                <div className="max-w-lg">
                  <h3 className="text-sm font-medium">{v.title}</h3>
                  <p className="text-muted-foreground mt-1 text-xs leading-5">
                    {v.description}
                  </p>
                </div>
                <BusyButton
                  variant="outline"
                  size="sm"
                  busy={download.isPending && download.variables === v.kind}
                  disabled={!desktop || download.isPending}
                  onClick={() => download.mutate(v.kind)}
                >
                  {v.kind === 'runtime' ? <ExternalLink /> : <Download />}
                  {v.label}
                </BusyButton>
              </div>
            ))}
          </div>
        </Panel>
        <div className="border-primary/20 bg-muted/50 flex gap-3 rounded-xl border p-5">
          <ShieldCheck className="text-primary mt-0.5 size-5 shrink-0" />
          <div>
            <h2 className="text-sm font-medium">从预演开始</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              发送类工作流支持预演：只填写、回读并清理本轮文字，不点击发送。正式发送时每个目标只尝试一次，结果不明确就停止，不自动重发。页面只通过系统无障碍控件读取，不截图、不上传画面。
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
