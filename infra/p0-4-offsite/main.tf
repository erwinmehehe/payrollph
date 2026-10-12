# Provision with an explicitly authorized AWS account; never apply from untrusted PRs.
# The immutable COMPLIANCE retention cannot be shortened for uploaded versions.
data "aws_caller_identity" "current" {}
resource "random_id" "bucket_suffix" { byte_length = 4 }
locals {
  repo         = "erwinmehehe/payrollph"
  bucket_name  = "payrollph-${data.aws_caller_identity.current.account_id}-offsite-${random_id.bucket_suffix.hex}"
  archive_path = "payrollph/immutable-backups/"
  oidc_arn     = var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn
}
resource "aws_iam_openid_connect_provider" "github" {
  count          = var.github_oidc_provider_arn == "" ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}
resource "aws_kms_key" "backups" {
  description = "PayrollPH P0-4 offsite encrypted archive envelope key"
  enable_key_rotation = true
  deletion_window_in_days = 30
}
resource "aws_kms_alias" "backups" {
  name          = "alias/payrollph-p0-4-backups"
  target_key_id = aws_kms_key.backups.key_id
}
resource "aws_s3_bucket" "backups" {
  bucket = local.bucket_name
  object_lock_enabled = true
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
      kms_master_key_id = aws_kms_key.backups.arn
    }
    bucket_key_enabled = true
  }
}
resource "aws_s3_bucket_object_lock_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.retention_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.backups]
}
data "aws_iam_policy_document" "bucket_policy" {
  statement {
    sid = "DenyInsecureTransport"
    effect = "Deny"
    actions = ["s3:*"]
    resources = [aws_s3_bucket.backups.arn, "${aws_s3_bucket.backups.arn}/*"]
    principals {
      type = "*"
      identifiers = ["*"]
    }
    condition {
      test = "Bool"
      variable = "aws:SecureTransport"
      values = ["false"]
    }
  }
  statement {
    sid = "RequireExplicitKMS"
    effect = "Deny"
    actions = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.backups.arn}/${local.archive_path}*"]
    principals {
      type = "*"
      identifiers = ["*"]
    }
    condition {
      test = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values = ["aws:kms"]
    }
  }
  statement {
    sid = "RequireDedicatedKMSKey"
    effect = "Deny"
    actions = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.backups.arn}/${local.archive_path}*"]
    principals {
      type = "*"
      identifiers = ["*"]
    }
    condition {
      test = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values = [aws_kms_key.backups.arn]
    }
  }
}
resource "aws_s3_bucket_policy" "backups" {
  bucket = aws_s3_bucket.backups.id
  policy = data.aws_iam_policy_document.bucket_policy.json
  depends_on = [aws_s3_bucket_public_access_block.backups]
}
data "aws_iam_policy_document" "backup_assume" {
  statement {
    effect = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type = "Federated"
      identifiers = [local.oidc_arn]
    }
    condition {
      test = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values = ["sts.amazonaws.com"]
    }
    condition {
      test = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = ["repo:${local.repo}:environment:payrollph-production-backup"]
    }
  }
}
data "aws_iam_policy_document" "restore_assume" {
  statement {
    effect = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type = "Federated"
      identifiers = [local.oidc_arn]
    }
    condition {
      test = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values = ["sts.amazonaws.com"]
    }
    condition {
      test = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = ["repo:${local.repo}:environment:payrollph-production-restore"]
    }
  }
}
resource "aws_iam_role" "backup" {
  name = "payrollph-p0-4-backup-upload"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
  max_session_duration = 3600
}
resource "aws_iam_role" "restore" {
  name = "payrollph-p0-4-restore-readonly"
  assume_role_policy = data.aws_iam_policy_document.restore_assume.json
  max_session_duration = 3600
}
data "aws_iam_policy_document" "backup_upload" {
  statement {
    sid = "InspectBucketGuards"
    actions = ["s3:GetBucketVersioning", "s3:GetBucketObjectLockConfiguration", "s3:GetBucketPublicAccessBlock"]
    resources = [aws_s3_bucket.backups.arn]
  }
  statement {
    sid = "WriteEncryptedImmutableCiphertext"
    actions = ["s3:PutObject", "s3:PutObjectRetention", "s3:GetObject"]
    resources = ["${aws_s3_bucket.backups.arn}/${local.archive_path}*"]
  }
  statement {
    sid = "EncryptOnly"
    actions = ["kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext"]
    resources = [aws_kms_key.backups.arn]
  }
}
resource "aws_iam_role_policy" "backup_upload" {
  name = "encrypted-archive-write-only"
  role = aws_iam_role.backup.id
  policy = data.aws_iam_policy_document.backup_upload.json
}
data "aws_iam_policy_document" "restore_readonly" {
  statement {
    sid = "ReadPinnedArchivedVersion"
    actions = ["s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectRetention"]
    resources = ["${aws_s3_bucket.backups.arn}/${local.archive_path}*"]
  }
  statement {
    sid = "DecryptOnly"
    actions = ["kms:DescribeKey", "kms:Decrypt"]
    resources = [aws_kms_key.backups.arn]
  }
}
resource "aws_iam_role_policy" "restore_readonly" {
  name = "encrypted-archive-read-only"
  role = aws_iam_role.restore.id
  policy = data.aws_iam_policy_document.restore_readonly.json
}
