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
    in
    {
      devShells = forAllSystems (system: {
        default = pkgs.${system}.mkShell {
          buildInputs = with pkgs.${system}; [
            nodejs_24
            python3
            gnumake
            gcc
            sqlite
          ];
          
          shellHook = ''
            export CXX=g++
          '';
        };
      });
    };
}
