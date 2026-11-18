#include <fcntl.h>
#include <stdio.h>

int main(int argc, char **argv) {
    if (argc != 3) {
        return 2;
    }
    if (renameatx_np(AT_FDCWD, argv[1], AT_FDCWD, argv[2], RENAME_SWAP) != 0) {
        perror("renameatx_np");
        return 1;
    }
    return 0;
}
