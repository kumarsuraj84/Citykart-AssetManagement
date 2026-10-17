// FAKE python.exe for the deploy dry run (compiled with Add-Type, C# 5). It installs nothing and connects to nothing.
// Behaviour comes from fake.ini next to the exe; the simulated database revision is kept in fake_db.txt.
//   pip_exit=<n>        exit code of "-m pip ..."
//   heads=<rev>         what "-m alembic heads" prints
//   current_exit=<n>    exit code of "-m alembic current" (non-zero = database not reachable)
//   upgrade_exit=<n>    exit code of "-m alembic upgrade head" (non-zero = migration failed, revision unchanged)
//   upgrade_to=<rev>    revision written to fake_db.txt by a successful upgrade (default: heads)
// Every call is appended to fake_calls.log (arguments, whether DATABASE_URL is set - never its value - and the cwd).
// The upgrade prints a fake "one-time owner password" line so the dry run can prove the deploy log hides it.
using System;
using System.IO;
using System.Collections.Generic;

public static class FakePython
{
    static Dictionary<string, string> ReadIni(string dir)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        string p = Path.Combine(dir, "fake.ini");
        if (File.Exists(p))
        {
            foreach (var l in File.ReadAllLines(p))
            {
                int i = l.IndexOf('=');
                if (i > 0) d[l.Substring(0, i).Trim()] = l.Substring(i + 1).Trim();
            }
        }
        return d;
    }

    static string Get(Dictionary<string, string> d, string k, string def)
    {
        string v;
        return d.TryGetValue(k, out v) ? v : def;
    }

    public static int Main(string[] a)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        var ini = ReadIni(dir);
        string state = Path.Combine(dir, "fake_db.txt");
        bool db = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DATABASE_URL"));
        File.AppendAllText(Path.Combine(dir, "fake_calls.log"),
            string.Join(" ", a) + " | DATABASE_URL set: " + (db ? "yes" : "no") + " | cwd: " + Environment.CurrentDirectory + Environment.NewLine);
        if (a.Length >= 2 && a[0] == "-m" && a[1] == "pip")
        {
            int code = int.Parse(Get(ini, "pip_exit", "0"));
            if (code == 0) Console.WriteLine("Successfully installed ckam-backend-0.1.0 (FAKE pip: nothing was installed)");
            else Console.Error.WriteLine("ERROR: FAKE pip failure (simulated, e.g. the package index cannot be reached)");
            return code;
        }
        if (a.Length >= 3 && a[0] == "-m" && a[1] == "alembic")
        {
            string cur = File.Exists(state) ? File.ReadAllText(state).Trim() : "";
            string heads = Get(ini, "heads", "c6e8a0b2d4f6");
            if (a[2] == "heads") { Console.WriteLine(heads + " (head)"); return 0; }
            if (a[2] == "current")
            {
                int ce = int.Parse(Get(ini, "current_exit", "0"));
                Console.Error.WriteLine("INFO  [alembic.runtime.migration] Context impl PostgresqlImpl. (FAKE)");
                if (ce != 0) { Console.Error.WriteLine("ERROR: FAKE could not connect to the database"); return ce; }
                if (cur != "") Console.WriteLine(cur + (cur == heads ? " (head)" : ""));
                return 0;
            }
            if (a[2] == "upgrade")
            {
                int ue = int.Parse(Get(ini, "upgrade_exit", "0"));
                Console.Error.WriteLine("INFO  [alembic.runtime.migration] Running upgrade (FAKE) from " + cur);
                Console.Error.WriteLine("INFO  FAKE bootstrap: one-time owner password: FAKE-ONE-TIME-PW-9f3k");
                if (ue != 0) { Console.Error.WriteLine("ERROR: FAKE migration failure, the transaction was rolled back"); return ue; }
                File.WriteAllText(state, Get(ini, "upgrade_to", heads));
                return 0;
            }
        }
        return 0;
    }
}
