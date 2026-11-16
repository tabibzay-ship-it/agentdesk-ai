from __future__ import annotations

import argparse
import pathlib
import sys
import tempfile

import py7zr
import pyrage


def read_secret() -> str:
    value = sys.stdin.readline().rstrip("\r\n")
    if not value:
        raise RuntimeError("required secret input was empty")
    return value


def create_archive(source: pathlib.Path, archive: pathlib.Path) -> None:
    password = read_secret()
    with py7zr.SevenZipFile(
        archive, "w", password=password, header_encryption=True
    ) as output:
        for item in source.rglob("*"):
            if item.is_file():
                output.write(item, item.relative_to(source).as_posix())


def test_archive(archive: pathlib.Path) -> None:
    password = read_secret()
    with py7zr.SevenZipFile(archive, "r", password=password) as source:
        if source.testzip() is not None:
            raise RuntimeError("archive integrity verification failed")


def extract_with_passphrase(
    passphrase: str,
    escrow: pathlib.Path,
    database_archive: pathlib.Path,
    storage_archive: pathlib.Path,
    database_target: pathlib.Path,
    storage_target: pathlib.Path,
) -> None:
    recovered_key = pyrage.passphrase.decrypt(
        escrow.read_bytes(), passphrase
    ).decode("utf-8")
    for archive, target in (
        (database_archive, database_target),
        (storage_archive, storage_target),
    ):
        with py7zr.SevenZipFile(archive, "r", password=recovered_key) as source:
            if source.testzip() is not None:
                raise RuntimeError("archive integrity verification failed")
        with py7zr.SevenZipFile(archive, "r", password=recovered_key) as source:
            source.extractall(path=target)


def independent_extract(
    escrow: pathlib.Path,
    database_archive: pathlib.Path,
    storage_archive: pathlib.Path,
    database_target: pathlib.Path,
    storage_target: pathlib.Path,
) -> None:
    extract_with_passphrase(
        read_secret(),
        escrow,
        database_archive,
        storage_archive,
        database_target,
        storage_target,
    )


def self_test() -> None:
    archive_key = "synthetic-archive-key-for-local-self-test"
    passphrase = "synthetic-v2-passphrase-for-local-self-test"
    with tempfile.TemporaryDirectory(dir=pathlib.Path.cwd()) as temporary:
        print("SELF_TEST_STAGE:setup", flush=True)
        root = pathlib.Path(temporary)
        sources = [root / "database-source", root / "storage-source"]
        archives = [root / "database.7z", root / "storage.7z"]
        targets = [root / "database-target", root / "storage-target"]
        for index, source in enumerate(sources):
            source.mkdir()
            (source / "proof.txt").write_text(f"proof-{index}", encoding="utf-8")
            with py7zr.SevenZipFile(
                archives[index], "w", password=archive_key, header_encryption=True
            ) as output:
                output.write(source / "proof.txt", "proof.txt")
        print("SELF_TEST_STAGE:archives", flush=True)
        escrow = root / "recovery.age"
        escrow.write_bytes(pyrage.passphrase.encrypt(archive_key.encode("utf-8"), passphrase))
        print("SELF_TEST_STAGE:escrow", flush=True)
        extract_with_passphrase(
            passphrase, escrow, archives[0], archives[1], targets[0], targets[1]
        )
        print("SELF_TEST_STAGE:extract", flush=True)
        for index, target in enumerate(targets):
            if (target / "proof.txt").read_text(encoding="utf-8") != f"proof-{index}":
                raise RuntimeError("self-test content mismatch")
    print("SELF_TEST_PASS")


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create")
    create.add_argument("source", type=pathlib.Path)
    create.add_argument("archive", type=pathlib.Path)

    test = subparsers.add_parser("test")
    test.add_argument("archive", type=pathlib.Path)

    extract = subparsers.add_parser("independent-extract")
    extract.add_argument("escrow", type=pathlib.Path)
    extract.add_argument("database_archive", type=pathlib.Path)
    extract.add_argument("storage_archive", type=pathlib.Path)
    extract.add_argument("database_target", type=pathlib.Path)
    extract.add_argument("storage_target", type=pathlib.Path)

    subparsers.add_parser("self-test")

    args = parser.parse_args()
    if args.command == "create":
        create_archive(args.source, args.archive)
    elif args.command == "test":
        test_archive(args.archive)
    elif args.command == "independent-extract":
        independent_extract(
            args.escrow,
            args.database_archive,
            args.storage_archive,
            args.database_target,
            args.storage_target,
        )
    else:
        self_test()


if __name__ == "__main__":
    main()
