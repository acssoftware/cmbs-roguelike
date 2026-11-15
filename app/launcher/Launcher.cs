// CMBS Roguelike - the launcher (14/11/2026, the author: a package for the community, without a console window).
//
// Starts the app's server (app\node\node.exe app\server.mjs) with no window, waits for the line it prints when it is
// ready ("  open       : http://localhost:<port>"), opens the app in a window of its own (Microsoft Edge in app mode,
// or the default browser) and stays in the system tray: Open, Open in default browser, Show log, Quit. Everything the
// server prints goes to %LOCALAPPDATA%\CMBS Roguelike\launcher.log.
//
// Built by tools/lancador/compilar.mjs with the C# compiler that ships with Windows (.NET Framework 4.x, C# 5): no
// string interpolation, no null-conditional operators, no nameof.
//
// Contracts with the server (app/server.mjs), checked by app/test.mjs:
//   - the ready line matches  open\s+:\s+(http://\S+)  and is the last line of the startup banner;
//   - when the port is taken it prints "Port <N> is already in use." to stderr and exits with code 1;
//   - POST /api/quit answers 200 and the process exits with code 0, or 500 with a reason while a battle is being built.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    public const string Name = "CMBS Roguelike";

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool first;
        using (Mutex mutex = new Mutex(true, "Local\\CMBS-Roguelike-Launcher", out first))
        {
            if (!first && !SecondInstance(mutex)) return;
            Places places = Places.Find();
            string problem = places.Problem();
            if (problem != null) { Fail(problem); return; }
            Application.Run(new Tray(places));
        }
    }

    public static string Version()
    {
        object[] a = Assembly.GetExecutingAssembly().GetCustomAttributes(typeof(AssemblyInformationalVersionAttribute), false);
        return a.Length > 0 ? ((AssemblyInformationalVersionAttribute)a[0]).InformationalVersion : "";
    }

    // The app is already running. From this same folder: open another window on it and leave (returns false). From
    // ANOTHER folder (15/11, the author: a new version extracted beside the old one opened the old one): without asking,
    // quit the running one, wait for its launcher to let go, and go on to start this one (returns true).
    static bool SecondInstance(Mutex mutex)
    {
        string url = null, dir = null, version = null;
        try
        {
            string[] lines = File.ReadAllLines(Places.UrlFile);
            if (lines.Length > 0) url = lines[0].Trim();
            if (lines.Length > 1) dir = lines[1].Trim();
            if (lines.Length > 2) version = lines[2].Trim();
        }
        catch (Exception) { }
        if (string.IsNullOrEmpty(url)) url = "http://localhost:8765";
        string mine = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        bool sameFolder = dir == null ? false : string.Equals(Path.GetFullPath(dir).TrimEnd('\\'), Path.GetFullPath(mine).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        if (sameFolder) { Browser.Open(url, true); return false; }
        // another folder: no question (the author, 15/11) - the one started last wins; the campaigns live in neither folder
        ServerProcess.Log("another copy is running (" + (version ?? "?") + " from " + (dir ?? "?") + "): quitting it to start " + Version() + " from " + mine);
        string port = ServerProcess.PortOf(url);
        try { ServerProcess.Http("POST", "http://127.0.0.1:" + (port ?? "8765") + "/api/quit", 3000); }
        catch (WebException e)
        {
            HttpWebResponse r = e.Response as HttpWebResponse;
            if (r != null)
            {
                string text = new StreamReader(r.GetResponseStream()).ReadToEnd();
                Match m = Regex.Match(text, "\"message\"\\s*:\\s*\"([^\"]*)\"");
                Fail("The running app refused to quit: " + (m.Success ? m.Groups[1].Value : text) + "\n\nTry again in a moment.");
                return false;
            }
        }
        catch (Exception) { }
        // its launcher exits when its server does, and lets go of the mutex
        bool got;
        try { got = mutex.WaitOne(20000); } catch (AbandonedMutexException) { got = true; }
        if (!got) { Fail("The running app did not close. Quit it from its tray icon (next to the clock), then start this one again."); return false; }
        return true;
    }

    public static void Fail(string text)
    {
        MessageBox.Show(text, Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}

// Where things are. The log always goes to %LOCALAPPDATA%\CMBS Roguelike: the launcher only exists in the package, and
// the package keeps its data there (app/src/settings.mjs).
sealed class Places
{
    public string ExeDir, AppDir, NodeExe;
    public static readonly string LogDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Program.Name);
    public static readonly string LogFile = Path.Combine(LogDir, "launcher.log");
    public static readonly string UrlFile = Path.Combine(LogDir, "launcher.url");

    public static Places Find()
    {
        Places p = new Places();
        p.ExeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        p.AppDir = Path.Combine(p.ExeDir, "app");
        string bundled = Path.Combine(p.AppDir, "node", "node.exe");
        if (File.Exists(bundled)) p.NodeExe = bundled;
        else p.NodeExe = OnPath("node.exe");
        try
        {
            Directory.CreateDirectory(LogDir);
            if (File.Exists(LogFile) && new FileInfo(LogFile).Length > 2 * 1024 * 1024)
            {
                string old = LogFile + ".old";
                if (File.Exists(old)) File.Delete(old);
                File.Move(LogFile, old);
            }
        }
        catch (Exception) { }
        return p;
    }

    static string OnPath(string exe)
    {
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string dir in path.Split(';'))
        {
            try { string f = Path.Combine(dir.Trim(), exe); if (dir.Trim().Length > 0 && File.Exists(f)) return f; }
            catch (Exception) { }
        }
        return null;
    }

    public string Problem()
    {
        if (!File.Exists(Path.Combine(AppDir, "server.mjs")))
            return "The app's files were not found next to this program.\n\nExtract the whole zip: the folder \"app\" must sit beside \"CMBS Roguelike.exe\".";
        if (NodeExe == null)
            return "Node.js was not found.\n\nThe package carries its own copy in app\\node; if it is missing, extract the whole zip again.\nOr install the LTS version from https://nodejs.org and start the app again.";
        return null;
    }
}

// The server process. The output handlers only take a lock and append: Node writes to a pipe synchronously on Windows,
// so a launcher that stopped draining would freeze the server in the middle of building a battle.
sealed class ServerProcess
{
    readonly Places places;
    readonly object gate = new object();
    readonly List<string> lastLines = new List<string>();
    readonly StringBuilder errors = new StringBuilder();
    Process proc;
    string url;
    static readonly Regex OpenLine = new Regex(@"open\s+:\s+(http://\S+)");

    public ServerProcess(Places places) { this.places = places; }

    public void Start()
    {
        ProcessStartInfo psi = new ProcessStartInfo(places.NodeExe, "server.mjs");
        psi.WorkingDirectory = places.AppDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;
        proc = new Process();
        proc.StartInfo = psi;
        proc.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { Take(e.Data, false); };
        proc.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { Take(e.Data, true); };
        Log("---- " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " starting " + places.NodeExe + " server.mjs in " + places.AppDir);
        proc.Start();
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
    }

    void Take(string line, bool isError)
    {
        if (line == null) return;
        lock (gate)
        {
            lastLines.Add(line);
            if (lastLines.Count > 40) lastLines.RemoveAt(0);
            if (isError) errors.AppendLine(line);
            if (url == null) { Match m = OpenLine.Match(line); if (m.Success) url = m.Groups[1].Value; }
        }
        Log(line);
    }

    public static void Log(string line)
    {
        try { File.AppendAllText(Places.LogFile, line + Environment.NewLine, Encoding.UTF8); } catch (Exception) { }
    }

    public string Url { get { lock (gate) return url; } }
    public string Errors { get { lock (gate) return errors.ToString(); } }
    public string LastLines(int n)
    {
        lock (gate) return string.Join("\n", lastLines.GetRange(Math.Max(0, lastLines.Count - n), Math.Min(n, lastLines.Count)).ToArray());
    }
    public bool HasExited { get { return proc == null || proc.HasExited; } }
    // Without a timeout: only this form waits for the asynchronous readers to empty.
    public int WaitAndCode() { proc.WaitForExit(); return proc.ExitCode; }

    // Ask the server to stop. Returns null when it stopped (or had to be killed), or the server's reason for refusing.
    public string TryQuit(int waitMs)
    {
        string port = PortOf(Url);
        if (port != null)
        {
            try
            {
                string body = Http("POST", "http://127.0.0.1:" + port + "/api/quit", 3000);
                Log("quit: " + body);
            }
            catch (WebException e)
            {
                HttpWebResponse r = e.Response as HttpWebResponse;
                if (r != null && (int)r.StatusCode == 500)
                {
                    string text = new StreamReader(r.GetResponseStream()).ReadToEnd();
                    Match m = Regex.Match(text, "\"message\"\\s*:\\s*\"([^\"]*)\"");
                    return m.Success ? m.Groups[1].Value : text;
                }
                Log("quit request failed: " + e.Message);
            }
        }
        if (!proc.WaitForExit(waitMs)) { try { proc.Kill(); } catch (Exception) { } }
        return null;
    }

    public static string PortOf(string u)
    {
        if (u == null) return null;
        Match m = Regex.Match(u, @":(\d+)");
        return m.Success ? m.Groups[1].Value : null;
    }

    public static string Http(string method, string address, int timeoutMs)
    {
        ServicePointManager.Expect100Continue = false;
        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(address);
        req.Method = method;
        req.Proxy = null;
        req.Timeout = timeoutMs;
        req.ReadWriteTimeout = timeoutMs;
        if (method == "POST") { req.ContentLength = 0; }
        using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
        using (StreamReader rd = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
            return rd.ReadToEnd();
    }
}

static class Browser
{
    // Edge is on every Windows 10/11 but not at one fixed path.
    public static string EdgePath()
    {
        string[] keys = { @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" };
        foreach (RegistryKey root in new RegistryKey[] { Registry.LocalMachine, Registry.CurrentUser })
        {
            foreach (string k in keys)
            {
                try
                {
                    using (RegistryKey key = root.OpenSubKey(k))
                    {
                        if (key == null) continue;
                        string p = key.GetValue("") as string;
                        if (!string.IsNullOrEmpty(p) && File.Exists(p.Trim('"'))) return p.Trim('"');
                    }
                }
                catch (Exception) { }
            }
        }
        foreach (string pf in new string[] { Environment.GetEnvironmentVariable("ProgramFiles(x86)"), Environment.GetEnvironmentVariable("ProgramFiles") })
        {
            if (string.IsNullOrEmpty(pf)) continue;
            string p = Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe");
            if (File.Exists(p)) return p;
        }
        return null;
    }

    // An app window through Edge when it is there; otherwise the default browser. The Edge process is not followed:
    // with Edge already open it hands the window to the running instance and exits at once.
    public static void Open(string url, bool preferEdge)
    {
        string edge = preferEdge ? EdgePath() : null;
        if (edge != null)
        {
            try { Process.Start(new ProcessStartInfo(edge, "--app=" + url + " --no-first-run")); return; }
            catch (Exception e) { ServerProcess.Log("edge failed: " + e.Message); }
        }
        try { ProcessStartInfo psi = new ProcessStartInfo(url); psi.UseShellExecute = true; Process.Start(psi); }
        catch (Exception e) { Program.Fail("Could not open the browser: " + e.Message + "\n\nOpen " + url + " yourself."); }
    }
}

// The tray icon and the life of the app. A WinForms timer drives everything, so no UI is touched from the output threads.
sealed class Tray : ApplicationContext
{
    readonly Places places;
    readonly ServerProcess server;
    readonly NotifyIcon icon = new NotifyIcon();
    readonly System.Windows.Forms.Timer tick = new System.Windows.Forms.Timer();
    bool urlSeen, quitting, done;
    string startError;

    public Tray(Places places)
    {
        this.places = places;
        server = new ServerProcess(places);
        icon.Icon = LoadIcon();
        icon.Text = Program.Name + " - starting";
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("Open", null, delegate { OpenApp(true); });
        menu.Items.Add("Open in default browser", null, delegate { OpenApp(false); });
        menu.Items.Add("Show log", null, delegate { try { Process.Start(new ProcessStartInfo("notepad.exe", "\"" + Places.LogFile + "\"")); } catch (Exception) { } });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit", null, delegate { Quit(); });
        icon.ContextMenuStrip = menu;
        icon.DoubleClick += delegate { OpenApp(true); };
        icon.Visible = true;
        // a failure here is reported from the first tick: ExitThread before Application.Run would leave Run waiting
        try { server.Start(); }
        catch (Exception e) { startError = e.Message; }
        tick.Interval = 250;
        tick.Tick += delegate { Poll(); };
        tick.Start();
    }

    static Icon LoadIcon()
    {
        try
        {
            Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("launcher.ico");
            if (s != null) return new Icon(s, SystemInformation.SmallIconSize);
        }
        catch (Exception) { }
        return SystemIcons.Application;
    }

    void OpenApp(bool preferEdge)
    {
        string u = server.Url;
        if (u != null) Browser.Open(u, preferEdge);
    }

    void Poll()
    {
        if (done) return;
        if (startError != null)
        {
            tick.Stop();
            Program.Fail("The app's server could not start: " + startError + "\n\nLog: " + Places.LogFile);
            Exit();
            return;
        }
        string u = server.Url;
        if (!urlSeen && u != null)
        {
            urlSeen = true;
            // the address, the folder and the version: a launcher started from another folder compares them
            try { File.WriteAllText(Places.UrlFile, u + "\r\n" + places.ExeDir + "\r\n" + Program.Version() + "\r\n"); } catch (Exception) { }
            string text = Program.Name + " - running on port " + ServerProcess.PortOf(u);
            icon.Text = text.Length > 63 ? text.Substring(0, 63) : text;
            Browser.Open(u, true);
            icon.ShowBalloonTip(5000, Program.Name, "The app is running. Right-click this icon to open it again or to quit.", ToolTipIcon.Info);
        }
        if (server.HasExited) OnServerExit(server.WaitAndCode());
    }

    void OnServerExit(int code)
    {
        tick.Stop();
        ServerProcess.Log("server exited with code " + code);
        if (quitting || (code == 0 && urlSeen)) { Exit(); return; }
        if (!urlSeen)
        {
            Match m = Regex.Match(server.Errors, @"Port (\d+) is already in use");
            if (m.Success)
            {
                string other = "http://localhost:" + m.Groups[1].Value;
                bool ours = false;
                try { ours = ServerProcess.Http("GET", "http://127.0.0.1:" + m.Groups[1].Value + "/api/status", 3000).Contains("\"api\""); }
                catch (Exception) { }
                if (ours)
                {
                    ServerProcess.Log("already running at " + other + ": opening it");
                    Browser.Open(other, true);
                    Exit();
                    return;
                }
                Program.Fail("Another program is using the port the app needs.\n\n" + server.Errors.Trim() + "\n\nLog: " + Places.LogFile);
                Exit();
                return;
            }
        }
        Program.Fail("The app's server stopped (exit code " + code + ").\n\n" + server.LastLines(15) + "\n\nLog: " + Places.LogFile);
        Exit();
    }

    void Quit()
    {
        if (done) return;
        quitting = true;
        string refusal = server.HasExited ? null : server.TryQuit(3000);
        if (refusal != null)
        {
            quitting = false;
            icon.ShowBalloonTip(5000, Program.Name, "Not now: " + refusal, ToolTipIcon.Warning);
            return;
        }
        Exit();
    }

    void Exit()
    {
        if (done) return;
        done = true;
        tick.Stop();
        icon.Visible = false;
        icon.Dispose();
        try { if (File.Exists(Places.UrlFile)) File.Delete(Places.UrlFile); } catch (Exception) { }
        ExitThread();
    }
}
