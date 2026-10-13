output "bucket_name" { value = aws_s3_bucket.backups.bucket }
output "kms_key_arn" { value = aws_kms_key.backups.arn }
output "backup_role_arn" { value = aws_iam_role.backup.arn }
output "restore_role_arn" { value = aws_iam_role.restore.arn }
output "s3_prefix" { value = "payrollph/immutable-backups" }
output "compliance_retention_days" { value = var.retention_days }
