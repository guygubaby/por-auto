import unittest

from wechat_demo import choose_device, find_me_tab, parse_nickname


class WeChatDemoTest(unittest.TestCase):
    def test_selects_only_authorized_device(self):
        self.assertEqual(choose_device({"phone-a": "unauthorized", "phone-b": "device"}, None), "phone-b")
        with self.assertRaisesRegex(RuntimeError, "USB 调试"):
            choose_device({"phone-a": "unauthorized"}, "phone-a")
        with self.assertRaisesRegex(RuntimeError, "设备列表为空"):
            choose_device({}, None)

    def test_does_not_guess_between_multiple_phones(self):
        devices = {"phone-a": "device", "phone-b": "device"}
        with self.assertRaisesRegex(RuntimeError, "--serial"):
            choose_device(devices, None)
        self.assertEqual(choose_device(devices, "phone-b"), "phone-b")
        with self.assertRaises(RuntimeError):
            choose_device(devices, "missing")

    def test_uses_bottom_tab_instead_of_chat_text(self):
        xml = '''<hierarchy><node>
          <node text="我" bounds="[40,200][100,240]"/>
          <node text="通讯录" bounds="[300,1800][400,1840]"/>
          <node text="发现" bounds="[600,1800][700,1840]"/>
          <node text="我" bounds="[900,1800][980,1840]"/>
        </node></hierarchy>'''
        self.assertEqual(find_me_tab(xml, 1920), (940, 1820))
        with self.assertRaisesRegex(RuntimeError, "微信主界面"):
            find_me_tab('<hierarchy><node text="我" bounds="[40,1600][100,1640]"/></hierarchy>', 1920)

    def test_reads_nickname_not_wechat_id(self):
        xml = '''<hierarchy><node>
          <node text="个人信息"/>
          <node><node><node text="昵称"/></node><node text="测试用户 🌱"/></node>
          <node><node text="微信号"/><node text="wxid_example"/></node>
        </node></hierarchy>'''
        self.assertEqual(parse_nickname(xml), "测试用户 🌱")

    def test_accepts_name_label_and_does_not_guess_missing_value(self):
        xml = '''<hierarchy><node><node text="个人信息"/>
          <node><node text="名字"/><node text="示例名称"/></node>
        </node></hierarchy>'''
        self.assertEqual(parse_nickname(xml), "示例名称")
        with self.assertRaises(RuntimeError):
            parse_nickname('''<hierarchy><node><node text="个人信息"/>
              <node><node text="昵称"/></node>
              <node><node text="微信号"/><node text="wxid_example"/></node>
            </node></hierarchy>''')

    def test_rejects_ambiguous_or_wrong_page(self):
        with self.assertRaises(RuntimeError):
            parse_nickname('''<hierarchy><node><node text="个人信息"/>
              <node><node text="昵称"/><node text="用户甲"/></node>
              <node><node text="昵称"/><node text="用户乙"/></node>
            </node></hierarchy>''')
        with self.assertRaisesRegex(RuntimeError, "个人信息页"):
            parse_nickname('<hierarchy><node text="微信号：wxid_example"/></hierarchy>')


if __name__ == "__main__":
    unittest.main()
