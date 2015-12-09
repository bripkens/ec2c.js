# Changelog

## v1.2.0
 - Define a private key for SSH connections via the `EC2C_PRIVATE_KEY` environment variable.

## v1.1.1
 - Do not define an empty default user name when the environment variable is not set.

## v1.1.0
 - Support definition of a default user name via `EC2C_DEFAULT_USER_NAME`.
 - Do not log a stack trace when the SSH connection terminates with a non-zero exit code.

## v1.0.0
 - Initial Release
