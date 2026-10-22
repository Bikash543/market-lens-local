using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("Market Lens Local")]
[assembly: AssemblyDescription("Local crypto futures research dashboard launcher")]
[assembly: AssemblyCompany("Bikash543")]
[assembly: AssemblyProduct("Market Lens Local")]
[assembly: AssemblyVersion("0.4.0.0")]
[assembly: AssemblyFileVersion("0.4.0.0")]

internal static class Launcher
{
    private static string lastError = "";
    [STAThread]
    private static int Main(string[] args)
    {
        string[] allowed = { "--background", "--stop", "--stop-if-owned", "--quiet" };
        if (args.Any(arg => !allowed.Contains(arg))) return 2;
        bool quiet = args.Contains("--quiet") || args.Contains("--background");
        if (quiet) return Run(args);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        int result = 1;
        using (Form window = new Form())
        {
            window.Text = "Market Lens Local";
            window.ClientSize = new Size(420, 128);
            window.StartPosition = FormStartPosition.CenterScreen;
            window.FormBorderStyle = FormBorderStyle.FixedDialog;
            window.MaximizeBox = false;
            window.MinimizeBox = false;
            window.BackColor = Color.FromArgb(20, 34, 31);
            window.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            Label status = new Label();
            status.Text = args.Contains("--stop") ? "Stopping background collection..." : "Starting Market Lens Local...\nYour dashboard will open when ready.";
            status.ForeColor = Color.FromArgb(223, 242, 235);
            status.Font = new Font("Segoe UI", 11);
            status.AutoSize = false;
            status.SetBounds(24, 28, 380, 70);
            window.Controls.Add(status);
            window.Shown += async delegate {
                result = await Task.Run(() => Run(args));
                if (result != 0) MessageBox.Show(window, lastError, "Market Lens could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
                window.Close();
            };
            Application.Run(window);
        }
        return result;
    }
    private static int Run(string[] args)
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string node = Path.Combine(root, "runtime", "node.exe");
            string command = Path.Combine(root, "local", "desktop-command.mjs");
            if (!File.Exists(node) || !File.Exists(command))
                throw new Exception("The installation is incomplete. Please run the Market Lens installer again.");
            ProcessStartInfo info = new ProcessStartInfo(node);
            info.Arguments = "\"" + command + "\" " + String.Join(" ", args.Where(arg => arg != "--quiet"));
            info.WorkingDirectory = root;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            info.RedirectStandardError = true;
            using (Process process = Process.Start(info))
            {
                Task<string> errors = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(240000)) { process.Kill(); throw new Exception("Startup timed out. Check the local service log or restart Windows."); }
                lastError = errors.Result.Trim();
                if (lastError.Length == 0 && process.ExitCode != 0) lastError = "The local background service could not start.";
                return process.ExitCode;
            }
        }
        catch (Exception error) { lastError = error.Message; return 1; }
    }
}
