{
  description = "StormDrain - Memory MCP Server";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      pkgs = forAllSystems (system: nixpkgs.legacyPackages.${system});

      tokensaveSources = {
        x86_64-linux = {
          url = "https://github.com/aovestdipaperino/tokensave/releases/download/v7.9.0/tokensave-v7.9.0-x86_64-linux.tar.gz";
          sha256 = "0cp37lzk3gag21s3j70a40sb54a7a2pp9iizgbdq8kmx7fvy0gcv";
        };
        aarch64-linux = {
          url = "https://github.com/aovestdipaperino/tokensave/releases/download/v7.9.0/tokensave-v7.9.0-aarch64-linux.tar.gz";
          sha256 = "0ryh91snl3mvfz4hsfgwzmdkanfv31gf4x8sz646wh6ry0c7zipd";
        };
      };
    in
    {
      packages = forAllSystems (system: rec {
        tokensave = pkgs.${system}.stdenv.mkDerivation {
          pname = "tokensave";
          version = "7.9.0";
          src = pkgs.${system}.fetchurl tokensaveSources.${system};
          nativeBuildInputs = [ pkgs.${system}.autoPatchelfHook ];
          buildInputs = with pkgs.${system}; [
            openssl
            zlib
            gcc-unwrapped.lib
          ];
          sourceRoot = ".";
          installPhase = ''
            install -m755 -D tokensave $out/bin/tokensave
          '';
        };
        default = tokensave;
      });

      devShells = forAllSystems (system: {
        default = pkgs.${system}.mkShell {
          buildInputs = with pkgs.${system}; [
            nodejs_24
            python3
            gnumake
            gcc
            sqlite
            self.packages.${system}.tokensave
          ];
          
          shellHook = ''
            export CXX=g++
          '';
        };
      });
    };
}
