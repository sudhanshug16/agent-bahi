#!/bin/bash

# Gate0 Database Integration Lifecycle Script
# Manages disposable PostgreSQL and MySQL containers for integration testing
# Never modifies existing localhost services or production data

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
UNIQUE_SUFFIX="${1:-test-$(date +%s)-$(openssl rand -hex 4)}"
POSTGRES_CONTAINER="agent-bahi-postgres-${UNIQUE_SUFFIX}"
MYSQL_CONTAINER="agent-bahi-mysql-${UNIQUE_SUFFIX}"
NETWORK_NAME="agent-bahi-net-${UNIQUE_SUFFIX}"

# Cleanup function - called on exit
cleanup() {
  local exit_code=$?

  echo -e "${YELLOW}Cleaning up test containers and network...${NC}"

  # Stop and remove containers
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${POSTGRES_CONTAINER}$"; then
    echo "Removing PostgreSQL container: ${POSTGRES_CONTAINER}"
    docker rm -f "${POSTGRES_CONTAINER}" 2>/dev/null || true
  fi

  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${MYSQL_CONTAINER}$"; then
    echo "Removing MySQL container: ${MYSQL_CONTAINER}"
    docker rm -f "${MYSQL_CONTAINER}" 2>/dev/null || true
  fi

  # Remove network
  if docker network ls --format '{{.Name}}' 2>/dev/null | grep -q "^${NETWORK_NAME}$"; then
    echo "Removing network: ${NETWORK_NAME}"
    docker network rm "${NETWORK_NAME}" 2>/dev/null || true
  fi

  # Verify cleanup
  local remaining_containers=0
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^agent-bahi-"; then
    remaining_containers=$(docker ps -a --format '{{.Names}}' | grep "^agent-bahi-" | wc -l)
    echo -e "${YELLOW}Warning: ${remaining_containers} agent-bahi containers may still exist${NC}"
  fi

  if [ $exit_code -eq 0 ]; then
    echo -e "${GREEN}Cleanup successful. No test containers remain.${NC}"
  else
    echo -e "${RED}Cleanup completed with exit code ${exit_code}${NC}"
  fi

  return $exit_code
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Check Docker availability
if ! command -v docker &> /dev/null; then
  echo -e "${RED}Error: docker command not found${NC}"
  exit 1
fi

if ! docker info &> /dev/null; then
  echo -e "${RED}Error: Docker daemon is not running${NC}"
  exit 1
fi

# Print configuration
echo -e "${GREEN}Gate0 Database Integration Lifecycle${NC}"
echo "======================================="
echo "Suffix: ${UNIQUE_SUFFIX}"
echo "PostgreSQL Container: ${POSTGRES_CONTAINER}"
echo "MySQL Container: ${MYSQL_CONTAINER}"
echo "Network: ${NETWORK_NAME}"
echo ""

# Create network
echo -e "${YELLOW}Creating Docker network...${NC}"
if docker network create "${NETWORK_NAME}" 2>/dev/null; then
  echo -e "${GREEN}Network created: ${NETWORK_NAME}${NC}"
else
  echo -e "${RED}Failed to create network${NC}"
  exit 1
fi

# Start PostgreSQL
echo -e "${YELLOW}Starting PostgreSQL 17.11 container...${NC}"
PG_PASSWORD=$(openssl rand -base64 32)
if docker run \
  --rm \
  -d \
  --name "${POSTGRES_CONTAINER}" \
  --network "${NETWORK_NAME}" \
  -e POSTGRES_USER=test_user \
  -e POSTGRES_PASSWORD="${PG_PASSWORD}" \
  -e POSTGRES_DB=testdb \
  --health-cmd="pg_isready -U test_user" \
  --health-interval=2s \
  --health-retries=10 \
  postgres:17.11 > /dev/null; then
  echo -e "${GREEN}PostgreSQL container started: ${POSTGRES_CONTAINER}${NC}"

  # Wait for PostgreSQL to be healthy
  echo "Waiting for PostgreSQL to be ready..."
  for i in {1..30}; do
    if docker exec "${POSTGRES_CONTAINER}" pg_isready -U test_user &> /dev/null; then
      echo -e "${GREEN}PostgreSQL is healthy${NC}"
      break
    fi
    if [ $i -eq 30 ]; then
      echo -e "${RED}PostgreSQL failed to become ready${NC}"
      exit 1
    fi
    sleep 1
  done
else
  echo -e "${RED}Failed to start PostgreSQL container${NC}"
  exit 1
fi

# Start MySQL
echo -e "${YELLOW}Starting MySQL 8.4 container...${NC}"
MYSQL_PASSWORD=$(openssl rand -base64 32)
if docker run \
  --rm \
  -d \
  --name "${MYSQL_CONTAINER}" \
  --network "${NETWORK_NAME}" \
  -e MYSQL_USER=test_user \
  -e MYSQL_PASSWORD="${MYSQL_PASSWORD}" \
  -e MYSQL_DATABASE=testdb \
  -e MYSQL_ROOT_PASSWORD=root_password \
  --health-cmd="mysqladmin ping -h localhost" \
  --health-interval=2s \
  --health-retries=10 \
  mysql:8.4 > /dev/null; then
  echo -e "${GREEN}MySQL container started: ${MYSQL_CONTAINER}${NC}"

  # Wait for MySQL to be healthy
  echo "Waiting for MySQL to be ready..."
  for i in {1..30}; do
    if docker exec "${MYSQL_CONTAINER}" mysqladmin ping -h localhost -u root -proot_password &> /dev/null; then
      echo -e "${GREEN}MySQL is healthy${NC}"
      break
    fi
    if [ $i -eq 30 ]; then
      echo -e "${RED}MySQL failed to become ready${NC}"
      exit 1
    fi
    sleep 1
  done
else
  echo -e "${RED}Failed to start MySQL container${NC}"
  exit 1
fi

# Verify containers are running
echo -e "${YELLOW}Verifying container status...${NC}"
docker ps --filter "name=${POSTGRES_CONTAINER}" --filter "name=${MYSQL_CONTAINER}" --format "table {{.Names}}\t{{.Status}}"

echo ""
echo -e "${GREEN}Containers are ready for testing${NC}"
echo "PostgreSQL: localhost (port will be 5432 or mapped)"
echo "MySQL: localhost (port will be 3306 or mapped)"
echo ""
echo "Run integration tests with:"
echo "  bun test tests/gate0/database-integration.test.ts"
echo ""

# Keep containers running until script exits
wait
