using System;
using System.Diagnostics;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("无限画布")]
[assembly: AssemblyProduct("INFINOTE 无限画布")]
[assembly: AssemblyDescription("无限画布快速启动器")]
[assembly: AssemblyVersion("1.0.0.0")]

class Launcher
{
    const string Url = "http://localhost:5173";
    const string ProjectDir = @"C:\Users\Administrator\Desktop\autocoding\无限画布";
    const string LogFile = @"C:\Users\Administrator\Desktop\autocoding\无限画布\launcher\dev-server.log";

    static bool IsUp()
    {
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(Url);
            req.Method = "GET";
            req.Timeout = 1200;
            using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
            {
                return (int)res.StatusCode < 400;
            }
        }
        catch
        {
            return false;
        }
    }

    static void OpenBrowser()
    {
        Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });
    }

    [STAThread]
    static void Main()
    {
        if (IsUp())
        {
            OpenBrowser();
            return;
        }

        try
        {
            string cmd = "/c npm run dev -- --port 5173 --strictPort >> \"" + LogFile + "\" 2>&1";
            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", cmd);
            psi.WorkingDirectory = ProjectDir;
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "无法启动画布服务：\n" + ex.Message + "\n\n请在项目目录运行 npm install，再重试。",
                "无限画布",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        // 最多等待 30 秒，等 Vite 就绪后打开浏览器
        for (int i = 0; i < 60; i++)
        {
            Thread.Sleep(500);
            if (IsUp())
            {
                OpenBrowser();
                return;
            }
        }

        MessageBox.Show(
            "画布启动超时。\n请检查项目依赖是否已安装（npm install），或端口 5173 是否被占用。\n\n日志：" + LogFile,
            "无限画布",
            MessageBoxButtons.OK,
            MessageBoxIcon.Warning);
    }
}
