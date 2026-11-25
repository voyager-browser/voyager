import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Self-signed localhost CA for automatic-update tests. Automatic updates are
 * HTTPS-only, so E2E needs a trusted local TLS server instead of plain HTTP.
 * The validity window starts well before any CI runner's clock and ends in
 * 2036, so checkouts of this fixture remain usable.
 */
const CERT = `-----BEGIN CERTIFICATE-----
MIIC9zCCAd+gAwIBAgIBATANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAkxMjcu
MC4wLjEwHhcNMjAwMTAxMDAwMDAwWhcNMzYwMTAxMDAwMDAwWjAUMRIwEAYDVQQD
DAkxMjcuMC4wLjEwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCf0zzI
D85nJmBSV2Gy9MdLRhEQ3uyb79z6q03Ef72SEzWQoVQ7VH8sjQo9yqt62b+HvGKQ
8XEC/IWxQ6226YS4lQVXtKwj+yE6yH2AcMT60hZxx45tn6hcPr3ZtsYnqVaW66tN
iseqQQlB39tUYPBg8sMNIKVNugPGWDTyDpb7He/aLjTSV2SuEDGIFDmMuadHXUSW
NTgqd+gvu/54xMU1eYht37/j2ffrL7fOmz3xVzS7sNMSIi3csWg7WZ1TFs2OY6UQ
HbzPTUW1lKw6qsTzWTi5FOb/sorMR2GOmoooF49MwlGzKKEf+HAlZQRXxn/+p9UB
SdExJ2d5iw2klUu1AgMBAAGjVDBSMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/
BAQDAgKkMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBoGA1UdEQQTMBGCCWxvY2FsaG9z
dIcEfwAAATANBgkqhkiG9w0BAQsFAAOCAQEAYr7R0QMhbA0JZkJhpjuD1c+It097
eOnWuV5FfDCYnDEWqDwb19RPY6pHRXMiqCApedakrcO+xkzq+0dQUWURglrRr48y
46FnntqDlGmk5lAK4on4H4uZ+qPpSB+htoO4VDzi+9veIeMafyx8/u8CakBKmIQd
kZset5HPom7XoDpP2+Huc5d1K4AXIc1aRsc8vI6kq0K1qBI72K36qg2XVthhm27F
5UZB0ZhjH4vKaV4gAZleQZ8pqTf9IR88rZ3EX5tc6QuLc9DOkZwqKeiA8k/6e+aP
MJGS38LeLDsropwbfSbCx/v9AT8+d48fOJ45/yunIu+Blp4KjaMkLBePFw==
-----END CERTIFICATE-----`

const KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCf0zzID85nJmBS
V2Gy9MdLRhEQ3uyb79z6q03Ef72SEzWQoVQ7VH8sjQo9yqt62b+HvGKQ8XEC/IWx
Q6226YS4lQVXtKwj+yE6yH2AcMT60hZxx45tn6hcPr3ZtsYnqVaW66tNiseqQQlB
39tUYPBg8sMNIKVNugPGWDTyDpb7He/aLjTSV2SuEDGIFDmMuadHXUSWNTgqd+gv
u/54xMU1eYht37/j2ffrL7fOmz3xVzS7sNMSIi3csWg7WZ1TFs2OY6UQHbzPTUW1
lKw6qsTzWTi5FOb/sorMR2GOmoooF49MwlGzKKEf+HAlZQRXxn/+p9UBSdExJ2d5
iw2klUu1AgMBAAECggEAC38kMubyK7jWum2XNUqG0HsajKpgfkoXjP+IEU+4CPsx
QfVc7ASkvkVp/G5o/eYOcTrjozX+8V5NVqY953euSKHNl9TDAjaVGhekcXoLLVix
7R7T975Bm9sWiIPthppXhHUw5hvKx4w0mIS8D/qGKA8maToVMf1kup6LNnNGuIr+
ZT8LPp08joNlZ2tbiGzpmBLTkcUgELmjiNpOmgJxV8D6MxbLZnIB/THRgIPsglhV
JHI38mdd+g3COdiGXVuJ6FGcPtAdu6lMyZ4eV0Fqn27jdo7SuUQuf5ZFK3+atU6y
/QyJX1KaoRSjK1CJICju9k64c3eYtNjm71NA3jssEQKBgQDLRHWRpVQnAITALCeA
+k5x31DOyGA0p02NIJmK5rwslDObt+N3LKT04lB/O1ZJtCHUyGYjBOsIxF5O1CGu
x0473fLEhJ0XIKJQLQIDcUavOEmMC6jUhDFsLMHka1zsw+snAXUFAsJoierH8ZD8
XhsgEmLlDTEh/JPnyZGf+wKgEQKBgQDJSaizKNwGSdUjFzd1bIgR4RF2Py4RFTCd
F7IrAPyW75amNTSHiB4PAtrPzkmi6y2cL1TuAVVDPNuoPiNMdOZajUPQu7RQfgYR
yhFkaXMwFvEpX+brHwRlu4OMDnfif0ob4C/ijAtfvhL3GCnAnCRiH2nIIBRijyKE
ywxGVX7VZQKBgHVo6rwhEjWhEAzstDjE3FDcHBIFHcTsKlhtTyMzWdgqFpFIq4Pn
7rRgkPyc6p+SA8SjqJNrwNMEkjDYSUhqaR8deZ/XteFpAThsdvBEGv8U9S6GgZOX
c/C2/ZwSA8/i7s5OAijNyjuWBl5Ng2CyftqMpEEH2Kx393r4LDyLQZ3xAoGBAIPY
Io8PkWbxD5GHkITyjQIhCR4J7jO0TH5pWgN/BvQahPPjX7/ysbWlagu5lFQJdXub
KScoal+7SimeYeKfo47mfugHOumKUpFuaQv7Yj66mEZAkfGqBGhadaTUiUQrmjA+
HT9n+b9Bsgx1oEuQOuimqNQz5wZTuQmAMk8TixtdAoGAQxMRHicU036TLL102jK+
lhY+lpcpsCaNgEO3sCIXDUkjlKxJc1Ay4XpVZ1VFWXmscPeR+72Y2kexREAzPIuP
DDGnlfp+2sje8CWcipY4SihpQirsnLr97sbSjnLddWtzk0MqIGux4+z4S9RFWFdS
Luv04DyLgSl/l9Y9N7H5P58=
-----END PRIVATE KEY-----`

export interface TestTls {
  readonly credentials: { cert: string; key: string }
  /** Pass to launchVoyager so main-process fetch trusts the local CA. */
  readonly env: Record<string, string>
  close(): void
}

export function createTestTls(): TestTls {
  const directory = mkdtempSync(join(tmpdir(), 'voyager-e2e-tls-'))
  const caPath = join(directory, 'ca.pem')
  writeFileSync(caPath, CERT)
  return {
    credentials: { cert: CERT, key: KEY },
    env: { NODE_EXTRA_CA_CERTS: caPath },
    close: () => rmSync(directory, { recursive: true, force: true })
  }
}
