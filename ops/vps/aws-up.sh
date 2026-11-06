#!/usr/bin/env bash
# Redeploy recipe (see ops/vps/README.md): from the repo root, with the AWS CLI logged in and .env.vps beside it,
#   bash ops/vps/aws-up.sh            # idempotent: key pair, SG, instance, EIP, Route 53, env, bundle, bootstrap
#   SKIP_BOOTSTRAP=1 bash ops/vps/aws-up.sh   # only refresh env + bundle on the box
# Private key: ~/.ssh/recharge-live.pem (override with KEY=).
# One-shot: Ubuntu 24.04 on EC2 + Elastic IP + Route 53 records + bootstrap. Idempotent where cheap.
#   AWS_REGION=ap-south-1 bash aws-up.sh            (needs a logged-in AWS CLI; run from the repo root)
set -euo pipefail
R="${AWS_REGION:-ap-south-1}"; export AWS_DEFAULT_REGION="$R"
DOMAIN=recharge.ajudiya.com; APP_HOST=app.recharge.ajudiya.com; API_HOST=api.recharge.ajudiya.com
NAME=recharge-live; TYPE="${INSTANCE_TYPE:-t3.medium}"; S="$(cd "$(dirname "$0")" && pwd)"; ENV_FILE="${ENV_FILE:-$PWD/.env.vps}"
REF="${REF:-claude/ethglobal-mumbai-build}"
[[ -r "$ENV_FILE" ]] || { echo "env file $ENV_FILE missing"; exit 2; }
say() { printf '\n== %s ==\n' "$*"; }

# An expired `aws login` session made every call below fail, and the old key-pair branch then redirected a failed
# create-key-pair INTO the private key file (2026-11-06: ~/.ssh/recharge-live.pem truncated to 0 bytes). Fail fast.
aws sts get-caller-identity >/dev/null 2>&1 || { echo "AWS session missing or expired: run 'aws login' and retry"; exit 2; }
say "key pair"; KEY="${KEY:-$HOME/.ssh/$NAME.pem}"
if aws ec2 describe-key-pairs --key-names "$NAME" >/dev/null 2>&1; then
  echo "exists (private key must be at $KEY)"
else
  # never overwrite an existing key file; write to a temp file and move it only when AWS returned key material
  [[ -s "$KEY" ]] && { echo "key pair $NAME not found but $KEY exists: refusing to overwrite it"; exit 2; }
  tmp="$(mktemp)"; aws ec2 create-key-pair --key-name "$NAME" --key-type ed25519 --query KeyMaterial --output text > "$tmp" \
    && [[ -s "$tmp" ]] && install -m 0600 "$tmp" "$KEY" && echo "created $KEY"; rm -f "$tmp"
fi
[[ -s "$KEY" ]] || { echo "no private key at $KEY"; exit 2; }

say "security group"; VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=$NAME Name=vpc-id,Values=$VPC --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)
if [[ -z "$SG" || "$SG" == "None" ]]; then
  SG=$(aws ec2 create-security-group --group-name "$NAME" --description "Recharge live: 22/80/443" --vpc-id "$VPC" --query GroupId --output text)
  for p in 22 80 443; do aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port $p --cidr 0.0.0.0/0 >/dev/null; done
fi; echo "$SG"

say "ami (Ubuntu 24.04 amd64)"; AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text); echo "$AMI"

say "instance"; ID=$(aws ec2 describe-instances --filters Name=tag:Name,Values=$NAME Name=instance-state-name,Values=pending,running --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || true)
if [[ -z "$ID" || "$ID" == "None" ]]; then
  ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" --key-name "$NAME" --security-group-ids "$SG" \
    --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3"}}]' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" --query 'Instances[0].InstanceId' --output text)
fi; echo "$ID"; aws ec2 wait instance-running --instance-ids "$ID"

say "elastic ip"; ALLOC=$(aws ec2 describe-addresses --filters Name=tag:Name,Values=$NAME --query 'Addresses[0].AllocationId' --output text 2>/dev/null || true)
if [[ -z "$ALLOC" || "$ALLOC" == "None" ]]; then ALLOC=$(aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" --query AllocationId --output text); fi
aws ec2 associate-address --instance-id "$ID" --allocation-id "$ALLOC" --allow-reassociation >/dev/null
IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text); echo "$IP"

say "route 53"; ZONE=$(aws route53 list-hosted-zones-by-name --dns-name ajudiya.com --query 'HostedZones[0].Id' --output text | sed 's#/hostedzone/##')
CH=$(for h in $DOMAIN $APP_HOST $API_HOST; do printf '{"Action":"UPSERT","ResourceRecordSet":{"Name":"%s","Type":"A","TTL":60,"ResourceRecords":[{"Value":"%s"}]}},' "$h" "$IP"; done)
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch "{\"Changes\":[${CH%,}]}" --query 'ChangeInfo.Status' --output text

say "ssh + env"; SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 ubuntu@$IP"
for i in $(seq 1 30); do $SSH true 2>/dev/null && break; sleep 10; done
$SSH 'sudo install -d -m 0700 /etc/recharge'; scp -i "$KEY" -o StrictHostKeyChecking=accept-new "$ENV_FILE" "ubuntu@$IP:/tmp/recharge.env"
$SSH 'sudo install -m 0600 /tmp/recharge.env /etc/recharge/.env && rm -f /tmp/recharge.env'

say "code (private repo: ship a git bundle, no token on the box)"; BUNDLE="$(mktemp -d)/recharge.bundle"
git bundle create "$BUNDLE" "$REF" >/dev/null; scp -i "$KEY" "$BUNDLE" "ubuntu@$IP:/tmp/recharge.bundle"; scp -i "$KEY" ops/vps/bootstrap.sh "ubuntu@$IP:/tmp/bootstrap.sh"; $SSH 'sudo install -m 0644 /tmp/recharge.bundle /opt/recharge.bundle'

if [[ "${SKIP_BOOTSTRAP:-0}" == 1 ]]; then say "bootstrap skipped (SKIP_BOOTSTRAP=1)"; else
say "bootstrap"; $SSH "sudo DOMAIN=$DOMAIN APP_HOST=$APP_HOST REPO_URL=/opt/recharge.bundle REF=$REF bash /tmp/bootstrap.sh"; fi
say "done"; echo "web https://$APP_HOST  api https://$API_HOST/healthz  ip $IP  instance $ID"
