using System;
using System.Security.Principal;
using System.Windows.Forms;

namespace RENI.UACTest
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool isAdmin = false;
            try
            {
                using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
                {
                    WindowsPrincipal principal = new WindowsPrincipal(identity);
                    isAdmin = principal.IsInRole(WindowsBuiltInRole.Administrator);
                }
            }
            catch {}

            if (isAdmin)
            {
                MessageBox.Show(
                    "UAC TEST SUCCESS!\n\nThis application is running with elevated Administrator privileges.\n\nThe RENI '🛡️ UAC YES' remote acceptance button functioned correctly!",
                    "RENI - UAC Elevation Verified",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            else
            {
                MessageBox.Show(
                    "WARNING: Application was NOT elevated.\nIf you clicked 'No' or bypassed UAC, it did not grant administrator rights.",
                    "RENI - UAC Elevation Test",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
            }
        }
    }
}
