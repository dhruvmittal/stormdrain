NPM ?= npm

.PHONY: all build deps build-server build-ui install uninstall check test clean distclean

all: build

deps:
	$(NPM) install
	$(NPM) --prefix ui install

build-server:
	$(NPM) run build

build-ui:
	$(NPM) --prefix ui run build

build: deps build-server build-ui

install: build
	$(NPM) link

uninstall:
	$(NPM) uninstall -g stormdrain

check: test

test:
	$(NPM) test

clean:
	rm -rf dist ui/dist

distclean: clean
	rm -rf node_modules ui/node_modules
