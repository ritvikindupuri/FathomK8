import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";

const exec = promisify(execFile);

const MAYA = { name: "Maya Chen", email: "maya.chen@example.com" };
const RITVIK = { name: "Ritvik Indupuri", email: "ritvikindupuri@users.noreply.github.com" };
const JORDAN = { name: "Jordan Hale", email: "jordan.hale@example.com" };
const PRIYA = { name: "Priya Shah", email: "priya.shah@example.com" };

const ADMIN_ROLE = "arn:aws:iam::482133619721:role/payments-administrator";
const READ_ROLE = "arn:aws:iam::482133619721:role/payments-receipts-read";

interface PaymentsOpts {
  irsa?: string;
  checkoutEscape: boolean;
  ledger: "none" | "admin" | "narrow";
  committedSecret: boolean;
}

interface GitopsOpts {
  daemonset: boolean;
  clusterAdmin: boolean;
  hostPort: boolean;
}

async function git(dir: string, args: string[], env?: NodeJS.ProcessEnv) {
  await exec("git", args, { cwd: dir, env: env || process.env });
}

async function replaceTree(dir: string, files: Record<string, string>) {
  for (const entry of await fs.readdir(dir)) {
    if (entry === ".git") continue;
    await fs.rm(path.join(dir, entry), { recursive: true, force: true });
  }
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(dir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content.endsWith("\n") ? content : `${content}\n`);
  }
}

async function commit(dir: string, subject: string, body: string, author: { name: string; email: string }, date: string) {
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", subject, "-m", body], {
    ...process.env,
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: author.name,
    GIT_COMMITTER_EMAIL: author.email,
    GIT_COMMITTER_DATE: date,
  });
}

async function initRepo(dir: string) {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, ["init", "-b", "main"]);
  await git(dir, ["config", "user.email", "fathom@example.com"]);
  await git(dir, ["config", "user.name", "Fathom"]);
  await git(dir, ["config", "commit.gpgsign", "false"]);
}

function hardened(indent: string) {
  return `${indent}privileged: false
${indent}allowPrivilegeEscalation: false
${indent}runAsNonRoot: true
${indent}runAsUser: 1000
${indent}readOnlyRootFilesystem: true
${indent}capabilities:
${indent}  drop: ["ALL"]`;
}

function paymentsFiles(opts: PaymentsOpts): Record<string, string> {
  const checkoutLabels = opts.checkoutEscape
    ? `        app: checkout`
    : `        app: checkout
        networking: restricted`;
  const checkoutPod = opts.checkoutEscape
    ? `      hostNetwork: true
      hostPID: true
      serviceAccountName: checkout
      containers:
        - name: checkout
          image: ghcr.io/example/checkout:1.4.2
          securityContext:
            privileged: true
            allowPrivilegeEscalation: true
            runAsUser: 0
          volumeMounts:
            - name: dockersock
              mountPath: /var/run/docker.sock
      volumes:
        - name: dockersock
          hostPath:
            path: /var/run/docker.sock`
    : `      serviceAccountName: checkout
      containers:
        - name: checkout
          image: ghcr.io/example/checkout:1.4.2
          securityContext:
${hardened("            ")}`;

  const ledger = opts.ledger === "none" ? "" : opts.ledger === "admin"
    ? `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ledger
  namespace: payments
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ledger
  namespace: payments
spec:
  selector:
    matchLabels:
      app: ledger
  template:
    metadata:
      labels:
        app: ledger
    spec:
      serviceAccountName: ledger
      containers:
        - name: ledger
          image: ghcr.io/example/ledger:0.9.0
          env:
            - name: MIGRATE_TOKEN
              valueFrom:
                secretKeyRef:
                  name: ledger-token
                  key: token
          securityContext:
            privileged: true
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ledger-migrate
subjects:
  - kind: ServiceAccount
    name: ledger
    namespace: payments
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
`
    : `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ledger
  namespace: payments
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ledger
  namespace: payments
spec:
  selector:
    matchLabels:
      app: ledger
  template:
    metadata:
      labels:
        app: ledger
        networking: restricted
    spec:
      serviceAccountName: ledger
      containers:
        - name: ledger
          image: ghcr.io/example/ledger:0.9.1
          securityContext:
${hardened("            ")}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ledger
  namespace: payments
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ledger
  namespace: payments
subjects:
  - kind: ServiceAccount
    name: ledger
    namespace: payments
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: ledger
`;

  const secret = opts.committedSecret
    ? `apiVersion: v1
kind: Secret
metadata:
  name: ledger-token
  namespace: payments
type: Opaque
stringData:
  token: s3cr3t-demo-value
`
    : "";

  const irsa = opts.irsa ? `\n  annotations:\n    eks.amazonaws.com/role-arn: ${opts.irsa}` : "";

  return {
    "Chart.yaml": `apiVersion: v2
name: payments-platform
description: Payments workloads
type: application
version: 0.4.0
appVersion: "1.4.2"
`,
    "values.yaml": "replicaCount: 2\n",
    "templates/namespaces.yaml": `apiVersion: v1
kind: Namespace
metadata:
  name: payments
---
apiVersion: v1
kind: Namespace
metadata:
  name: pci
`,
    "templates/serviceaccounts.yaml": `apiVersion: v1
kind: ServiceAccount
metadata:
  name: payments-api
  namespace: payments${irsa}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: checkout
  namespace: payments
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: billing
  namespace: payments
`,
    "templates/payments-api.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
  namespace: payments
spec:
  selector:
    matchLabels:
      app: payments-api
  template:
    metadata:
      labels:
        app: payments-api
        networking: restricted
    spec:
      serviceAccountName: payments-api
      containers:
        - name: api
          image: ghcr.io/example/payments-api:1.4.2
          ports:
            - containerPort: 8080
          securityContext:
${hardened("            ")}
`,
    "templates/checkout.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: payments
spec:
  selector:
    matchLabels:
      app: checkout
  template:
    metadata:
      labels:
${checkoutLabels}
    spec:
${checkoutPod}
`,
    "templates/billing.yaml": `apiVersion: batch/v1
kind: CronJob
metadata:
  name: billing
  namespace: payments
spec:
  schedule: "15 2 * * *"
  jobTemplate:
    spec:
      template:
        metadata:
          labels:
            app: billing
            networking: restricted
        spec:
          restartPolicy: OnFailure
          serviceAccountName: billing
          containers:
            - name: billing
              image: ghcr.io/example/billing:1.4.2
              securityContext:
${hardened("                ")}
`,
    "templates/postgres.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: payments
spec:
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
        networking: restricted
    spec:
      serviceAccountName: default
      containers:
        - name: postgres
          image: postgres:16
          securityContext:
${hardened("            ")}
`,
    "templates/vault.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: pci-vault
  namespace: pci
spec:
  selector:
    matchLabels:
      app: pci-vault
  template:
    metadata:
      labels:
        app: pci-vault
        networking: restricted
    spec:
      serviceAccountName: default
      containers:
        - name: vault
          image: hashicorp/vault:1.18
          securityContext:
${hardened("            ")}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: vault-deny-egress
  namespace: pci
spec:
  podSelector:
    matchLabels:
      app: pci-vault
  policyTypes:
    - Egress
  egress: []
`,
    "templates/services.yaml": `apiVersion: v1
kind: Service
metadata:
  name: payments-api
  namespace: payments
spec:
  selector:
    app: payments-api
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: checkout
  namespace: payments
spec:
  selector:
    app: checkout
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: payments
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
---
apiVersion: v1
kind: Service
metadata:
  name: pci-vault
  namespace: pci
spec:
  selector:
    app: pci-vault
  ports:
    - port: 8200
      targetPort: 8200
`,
    "templates/networkpolicy.yaml": `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: payments
spec:
  podSelector:
    matchLabels:
      networking: restricted
  policyTypes:
    - Egress
  egress: []
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-to-postgres
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app: payments-api
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - protocol: TCP
          port: 5432
`,
    ...(ledger ? { "templates/ledger.yaml": ledger } : {}),
    ...(secret ? { "templates/ledger-secret.yaml": secret } : {}),
  };
}

function gitopsFiles(opts: GitopsOpts): Record<string, string> {
  const resources = ["namespace.yaml", "serviceaccounts.yaml", "deployment.yaml", "service.yaml", "networkpolicy.yaml", "rbac.yaml"];
  if (opts.daemonset) resources.push("daemonset.yaml");
  const base: Record<string, string> = {
    "base/kustomization.yaml": `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: platform
resources:
${resources.map((resource) => `  - ${resource}`).join("\n")}
`,
    "base/namespace.yaml": `apiVersion: v1
kind: Namespace
metadata:
  name: platform
`,
    "base/serviceaccounts.yaml": `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ingress-edge
  namespace: platform
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gitops-reconciler
  namespace: platform
`,
    "base/deployment.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ingress-edge
  namespace: platform
spec:
  selector:
    matchLabels:
      app: ingress-edge
  template:
    metadata:
      labels:
        app: ingress-edge
    spec:
      serviceAccountName: ingress-edge
      containers:
        - name: controller
          image: ghcr.io/example/ingress-edge:2.1.0
          ports:
            - name: http
              containerPort: 80
          securityContext:
${hardened("            ")}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gitops-reconciler
  namespace: platform
spec:
  selector:
    matchLabels:
      app: gitops-reconciler
  template:
    metadata:
      labels:
        app: gitops-reconciler
    spec:
      serviceAccountName: gitops-reconciler
      containers:
        - name: reconciler
          image: ghcr.io/example/reconciler:0.6.0
          securityContext:
${hardened("            ")}
`,
    "base/service.yaml": `apiVersion: v1
kind: Service
metadata:
  name: ingress-edge
  namespace: platform
spec:
  selector:
    app: ingress-edge
  ports:
    - port: 80
      targetPort: 80
`,
    "base/networkpolicy.yaml": `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: platform-deny-egress
  namespace: platform
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress: []
`,
    "base/rbac.yaml": opts.clusterAdmin
      ? `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: gitops-reconciler
subjects:
  - kind: ServiceAccount
    name: gitops-reconciler
    namespace: platform
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
`
      : `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: gitops-reconciler
  namespace: platform
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: gitops-reconciler
  namespace: platform
subjects:
  - kind: ServiceAccount
    name: gitops-reconciler
    namespace: platform
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: gitops-reconciler
`,
  };
  if (opts.daemonset) {
    base["base/daemonset.yaml"] = `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-debug
  namespace: platform
spec:
  selector:
    matchLabels:
      app: node-debug
  template:
    metadata:
      labels:
        app: node-debug
    spec:
      hostPID: true
      serviceAccountName: default
      containers:
        - name: debug
          image: ghcr.io/example/node-debug:0.3.1
          securityContext:
            privileged: true
          volumeMounts:
            - name: runtime
              mountPath: /var/run/containerd/containerd.sock
      volumes:
        - name: runtime
          hostPath:
            path: /var/run/containerd/containerd.sock
`;
  }
  const overlay: Record<string, string> = {
    "overlays/prod/kustomization.yaml": `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: platform
resources:
  - ../../base
${opts.hostPort ? "patches:\n  - path: hostport.yaml\n" : ""}`,
  };
  if (opts.hostPort) {
    overlay["overlays/prod/hostport.yaml"] = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ingress-edge
  namespace: platform
spec:
  template:
    spec:
      containers:
        - name: controller
          ports:
            - name: http
              containerPort: 80
              hostPort: 80
`;
  }
  return { ...base, ...overlay };
}

const EMERGENCY = `apiVersion: v1
kind: ServiceAccount
metadata:
  name: emergency-backup
  namespace: payments
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: emergency-backup
subjects:
  - kind: ServiceAccount
    name: emergency-backup
    namespace: payments
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: emergency-backup
  namespace: payments
spec:
  schedule: "0 * * * *"
  jobTemplate:
    spec:
      template:
        metadata:
          labels:
            app: emergency-backup
        spec:
          restartPolicy: OnFailure
          serviceAccountName: emergency-backup
          hostNetwork: true
          hostPID: true
          containers:
            - name: backup
              image: ghcr.io/example/backup:0.1.0
              securityContext:
                privileged: true
              volumeMounts:
                - name: root
                  mountPath: /host
          volumes:
            - name: root
              hostPath:
                path: /
`;

async function seedHistory(dir: string, steps: { files: Record<string, string>; subject: string; body: string; author: { name: string; email: string }; date: string }[]) {
  await initRepo(dir);
  for (const step of steps) {
    await replaceTree(dir, step.files);
    await commit(dir, step.subject, step.body, step.author, step.date);
  }
  await git(dir, ["tag", "fathom-seed"]);
}

export async function seedPayments(dir: string) {
  await seedHistory(dir, [
    {
      files: paymentsFiles({ checkoutEscape: false, ledger: "none", committedSecret: false }),
      subject: "Add payments baseline with default-deny egress",
      body: "Keep every workload non-root and restrict payments-api to postgres.",
      author: MAYA,
      date: "2026-09-02T15:04:00Z",
    },
    {
      files: paymentsFiles({ irsa: ADMIN_ROLE, checkoutEscape: false, ledger: "none", committedSecret: false }),
      subject: "Attach payments-api to an administrator IRSA role",
      body: "Demo-PR: 12",
      author: RITVIK,
      date: "2026-09-18T18:22:00Z",
    },
    {
      files: paymentsFiles({ irsa: ADMIN_ROLE, checkoutEscape: true, ledger: "none", committedSecret: false }),
      subject: "Run checkout as privileged to debug DNS",
      body: "Demo-PR: 18",
      author: JORDAN,
      date: "2026-10-03T11:16:00Z",
    },
    {
      files: paymentsFiles({ irsa: ADMIN_ROLE, checkoutEscape: true, ledger: "admin", committedSecret: true }),
      subject: "Bind ledger to cluster-admin for the migration",
      body: "Demo-PR: 27",
      author: PRIYA,
      date: "2026-10-21T20:41:00Z",
    },
    {
      files: paymentsFiles({ irsa: READ_ROLE, checkoutEscape: false, ledger: "narrow", committedSecret: false }),
      subject: "Scope the cloud role and remove cluster-admin",
      body: "Demo-PR: 33",
      author: MAYA,
      date: "2026-11-06T16:05:00Z",
    },
  ]);
}

export async function seedGitops(dir: string) {
  await seedHistory(dir, [
    {
      files: gitopsFiles({ daemonset: false, clusterAdmin: false, hostPort: true }),
      subject: "Add platform ingress baseline",
      body: "Ingress is non-root. Egress is denied for the namespace.",
      author: MAYA,
      date: "2026-08-12T13:00:00Z",
    },
    {
      files: gitopsFiles({ daemonset: true, clusterAdmin: false, hostPort: true }),
      subject: "Add privileged node debug daemonset",
      body: "Demo-PR: 8",
      author: JORDAN,
      date: "2026-09-09T09:30:00Z",
    },
    {
      files: gitopsFiles({ daemonset: true, clusterAdmin: true, hostPort: true }),
      subject: "Grant gitops-reconciler cluster-admin",
      body: "Demo-PR: 11",
      author: PRIYA,
      date: "2026-10-02T17:12:00Z",
    },
    {
      files: gitopsFiles({ daemonset: true, clusterAdmin: false, hostPort: false }),
      subject: "Remove cluster-admin from the reconciler",
      body: "Demo-PR: 16",
      author: RITVIK,
      date: "2026-11-04T21:18:00Z",
    },
  ]);
}

async function hasSeed(dir: string) {
  try {
    await exec("git", ["rev-parse", "fathom-seed"], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

export function demoRoot() {
  return path.join(process.cwd(), ".data", "demos");
}

export async function ensureDemos(root = demoRoot()) {
  const payments = path.join(root, "payments-platform");
  const gitops = path.join(root, "platform-gitops");
  if (!(await hasSeed(payments))) {
    await fs.rm(payments, { recursive: true, force: true });
    await seedPayments(payments);
  }
  if (!(await hasSeed(gitops))) {
    await fs.rm(gitops, { recursive: true, force: true });
    await seedGitops(gitops);
  }
  return { payments, gitops };
}

export async function toggleEmergency(dir: string): Promise<"added" | "removed"> {
  const file = path.join(dir, "templates", "emergency-backup.yaml");
  try {
    await fs.access(file);
    await fs.rm(file);
    await commit(dir, "Revert emergency backup job", "Demo-PR: 42", MAYA, new Date().toISOString());
    return "removed";
  } catch {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, EMERGENCY);
    await commit(dir, "Add emergency backup job on the node", "Demo-PR: 41", JORDAN, new Date().toISOString());
    return "added";
  }
}
