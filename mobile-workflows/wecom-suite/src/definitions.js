// GENERATED from desktop definitions.
module.exports = {
  "schemaVersion": 1,
  "package": "com.tencent.wework",
  "workflows": [
    {
      "schemaVersion": 1,
      "minEngine": 4,
      "id": "wecom-open",
      "name": "打开企业微信",
      "version": "1.0.0",
      "description": "切回企业微信的消息首页，恢复到第一个导航项。",
      "package": "com.tencent.wework",
      "steps": [
        {
          "id": "wake",
          "name": "唤醒手机",
          "action": {
            "type": "wake"
          }
        },
        {
          "id": "launch",
          "name": "打开企业微信",
          "action": {
            "type": "launch",
            "activity": ".launch.LaunchSplashActivity"
          }
        },
        {
          "id": "wait",
          "name": "等待页面就绪",
          "action": {
            "type": "wait",
            "ms": 1200
          }
        },
        {
          "id": "home",
          "name": "返回消息首页",
          "action": {
            "type": "chat_home"
          }
        }
      ]
    },
    {
      "schemaVersion": 1,
      "minEngine": 4,
      "id": "wecom-nickname",
      "name": "读取企业微信姓名",
      "version": "1.0.0",
      "description": "打开侧边栏个人信息，通过原生控件读取当前登录姓名。",
      "package": "com.tencent.wework",
      "steps": [
        {
          "id": "wake",
          "name": "唤醒手机",
          "action": {
            "type": "wake"
          }
        },
        {
          "id": "launch",
          "name": "打开企业微信",
          "action": {
            "type": "launch",
            "activity": ".launch.LaunchSplashActivity"
          }
        },
        {
          "id": "wait",
          "name": "等待页面就绪",
          "action": {
            "type": "wait",
            "ms": 1200
          }
        },
        {
          "id": "profile",
          "name": "读取个人信息",
          "action": {
            "type": "chat_profile",
            "output": "nickname"
          }
        }
      ]
    },
    {
      "schemaVersion": 1,
      "minEngine": 4,
      "id": "wecom-first-chat",
      "name": "打开企业微信首个会话",
      "version": "1.0.0",
      "description": "返回消息首页，跳过功能入口，打开首个普通聊天会话。",
      "package": "com.tencent.wework",
      "steps": [
        {
          "id": "wake",
          "name": "唤醒手机",
          "action": {
            "type": "wake"
          }
        },
        {
          "id": "launch",
          "name": "打开企业微信",
          "action": {
            "type": "launch",
            "activity": ".launch.LaunchSplashActivity"
          }
        },
        {
          "id": "wait",
          "name": "等待页面就绪",
          "action": {
            "type": "wait",
            "ms": 1200
          }
        },
        {
          "id": "first",
          "name": "打开首个普通会话",
          "action": {
            "type": "chat_first_chat",
            "output": "chat_title"
          }
        }
      ]
    },
    {
      "schemaVersion": 1,
      "minEngine": 5,
      "id": "wecom-broadcast",
      "name": "企业微信批量发送消息",
      "version": "1.1.2",
      "description": "选择全部单聊、全部群聊或两者，按原生列表逐个处理并发送；支持手动或 HTTP 消息、逐会话记录与定时任务。",
      "package": "com.tencent.wework",
      "steps": [
        {
          "id": "wake",
          "name": "唤醒手机",
          "action": {
            "type": "wake"
          }
        },
        {
          "id": "launch",
          "name": "打开企业微信",
          "action": {
            "type": "launch",
            "activity": ".launch.LaunchSplashActivity"
          }
        },
        {
          "id": "wait",
          "name": "等待页面就绪",
          "action": {
            "type": "wait",
            "ms": 1200
          }
        },
        {
          "id": "broadcast",
          "name": "处理配置的接收对象",
          "action": {
            "type": "chat_broadcast"
          }
        }
      ],
      "inputSchema": {
        "$ref": "por-auto://schemas/chat-send-input/v1"
      }
    }
  ]
};
